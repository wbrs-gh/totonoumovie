/* トトノちゃん：画面の案内役（しゃべる・口を動かす・てくてく歩く・指さす・ツアー） */
"use strict";

(function () {
  const BASE = window.TOTONO_BASE || "/static/totono/";
  const Q = window.TOTONO_Q || "";  // マニュアルサイトでは古い絵・声が残らないよう付ける
  let META = null;      // 画像ごとの口の位置など（meta.json）
  let LINES = {};       // あらかじめ作った声（voice/lines.json）

  // 口の形（母音ごと）。viewBox 0 0 40 30 の中に描く
  const MOUTH = {
    n: '<path d="M11 13 Q20 19.5 29 13" fill="none" stroke="#2a2f4f" stroke-width="2.6" stroke-linecap="round"/>',
    a: '<path d="M10 10 Q20 7.5 30 10 Q28.5 27 20 27 Q11.5 27 10 10Z" fill="#b8344c" stroke="#2a2f4f" stroke-width="2.2" stroke-linejoin="round"/><ellipse cx="20" cy="22.5" rx="6" ry="3.6" fill="#f08a9a"/>',
    i: '<path d="M8 12 Q20 9.5 32 12 Q26 20 20 20 Q14 20 8 12Z" fill="#b8344c" stroke="#2a2f4f" stroke-width="2.2" stroke-linejoin="round"/><path d="M10 12.4 Q20 10.6 30 12.4 L29 14.6 Q20 13.2 11 14.6Z" fill="#fff"/>',
    u: '<ellipse cx="20" cy="15.5" rx="5" ry="5.2" fill="#b8344c" stroke="#2a2f4f" stroke-width="2.2"/><ellipse cx="20" cy="18" rx="2.6" ry="1.6" fill="#f08a9a"/>',
    e: '<path d="M9 11 Q20 8.5 31 11 Q27.5 22.5 20 22.5 Q12.5 22.5 9 11Z" fill="#b8344c" stroke="#2a2f4f" stroke-width="2.2" stroke-linejoin="round"/><ellipse cx="20" cy="19" rx="5" ry="2.6" fill="#f08a9a"/>',
    o: '<ellipse cx="20" cy="16" rx="7" ry="8.4" fill="#b8344c" stroke="#2a2f4f" stroke-width="2.2"/><ellipse cx="20" cy="20.5" rx="4" ry="2.6" fill="#f08a9a"/>',
  };
  const VOWEL = { a: "a", i: "i", u: "u", e: "e", o: "o", A: "a", I: "i", U: "u", E: "e", O: "o", N: "n", cl: "n", pau: "n" };

  // ひらがな・カタカナから母音を推す（声が無いときの口の動き用）
  const KANA_V = {};
  ["あかさたなはまやらわがざだばぱぁゃ", "いきしちにひみりぎじぢびぴぃ", "うくすつぬふむゆるぐずづぶぷぅゅっ", "えけせてねへめれげぜでべぺぇ", "おこそとのほもよろをごぞどぼぽぉょ"]
    .forEach((s, i) => { for (const c of s) { KANA_V[c] = "aiueo"[i]; KANA_V[String.fromCharCode(c.charCodeAt(0) + 0x60)] = "aiueo"[i]; } });
  function textVisemes(text) {
    const out = [];
    let t = 0.05;
    for (const ch of text) {
      if (/[、。！？!?\s]/.test(ch)) { out.push([t, t + 0.22, "n"]); t += 0.22; continue; }
      const v = ch === "ん" || ch === "ン" ? "n" : KANA_V[ch] || "aiueo"[(ch.charCodeAt(0) * 7) % 5];
      out.push([t, t + 0.12, v]);
      t += 0.12;
    }
    return out;
  }

  function muted() { try { return localStorage.getItem("totono-mute") === "1"; } catch (e) { return false; } }
  const ALL = new Set();   // 画面にいるトトノちゃん全員（声のオン・オフをそろえる）
  function setMuted(v) {
    try { localStorage.setItem("totono-mute", v ? "1" : "0"); } catch (e) { /* 無視 */ }
    ALL.forEach((c) => { c.updateMute(); if (v && c.audio) c.audio.pause(); });
    document.dispatchEvent(new CustomEvent("totono-mute", { detail: v }));
  }

  // ---- 歩く音（てくてく）：WebAudio でその場で作る小さな足音。声をオフにしているときは鳴らさない ----
  let actx = null;
  // 声・動画が重ならないように：後から鳴ったもの以外は止める
  function hushOthers(except) {
    ALL.forEach((c) => { if (c !== except && c.audio && !c.audio.paused) c.yieldVoice(); });
    document.querySelectorAll("video, audio").forEach((m) => { if (m !== except && !m.paused) m.pause(); });
  }
  // ページ上の動画が再生されたら、ほかの声・動画を止める（play は泡立たないので capture で拾う）
  document.addEventListener("play", (e) => { if (e.target instanceof HTMLMediaElement) hushOthers(e.target); }, true);

  function stepSound(left) {
    if (muted()) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(left ? 520 : 440, t);            // 左右で少し高さを変えて「て・く」に聞こえるように
      o.frequency.exponentialRampToValueAtTime(left ? 260 : 220, t + 0.07);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(g).connect(actx.destination);
      o.start(t); o.stop(t + 0.1);
    } catch (e) { /* 音が出せない環境では鳴らさない */ }
  }
  // ---- 足あと：足もとに小さく残して、1秒で消える ----
  function footprint(x, y, deg, left) {
    // 進む向き（deg）に合わせて回し、左右の足を少し横にずらす
    const r = (deg + 90) * Math.PI / 180, off = left ? -6 : 6;
    const d = document.createElement("div");
    d.className = "tt-foot";
    d.style.left = x + Math.cos(r) * off + "px";
    d.style.top = y + Math.sin(r) * off + "px";
    d.style.transform = `translate(-50%, -50%) rotate(${deg + 90}deg)`;
    d.addEventListener("animationend", () => d.remove());
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 1500);   // 念のため
  }

  async function loadMeta() {
    if (META) return META;
    try { META = await (await fetch(BASE + "meta.json" + Q)).json(); } catch (e) { META = { poses: {} }; }
    try { LINES = await (await fetch(BASE + "voice/lines.json" + Q)).json(); } catch (e) { LINES = {}; }
    return META;
  }

  // ==================================================================
  // キャラクター1体
  // ==================================================================
  class Chara {
    constructor(host, opts = {}) {
      this.size = opts.size || 150;
      this.el = document.createElement("div");
      this.el.className = "tt " + (opts.floating ? "tt-float" : "tt-inline") + (opts.bubbleSide === "left" ? " tt-bl" : "");
      this.el.innerHTML = `<div class="tt-body" style="width:${this.size}px"><img class="tt-img" alt="トトノちゃん" draggable="false"><svg class="tt-mouth" viewBox="0 0 40 30"></svg></div>
        <div class="tt-bubble hidden"><div class="tt-name">トトノちゃん<button class="tt-mute" title="声のオン・オフ"></button></div><div class="tt-text"></div><div class="tt-actions"></div></div>`;
      host.appendChild(this.el);
      this.img = this.el.querySelector(".tt-img");
      this.mouth = this.el.querySelector(".tt-mouth");
      this.bubble = this.el.querySelector(".tt-bubble");
      this.textEl = this.el.querySelector(".tt-text");
      this.actEl = this.el.querySelector(".tt-actions");
      this.muteBtn = this.el.querySelector(".tt-mute");
      this.audio = null;
      this.speakId = 0;
      this.pose = null;
      this.flip = false;
      this.updateMute();
      ALL.add(this);
      this.muteBtn.addEventListener("click", (e) => { e.stopPropagation(); setMuted(!muted()); });
      this.img.addEventListener("click", () => this.onClick && this.onClick());
      loadMeta().then(() => this.setPose(opts.pose || "wave"));
    }
    updateMute() { this.muteBtn.textContent = muted() ? "🔇" : "🔊"; }

    setPose(name, flip) {
      if (!META) return;
      const p = META.poses[name] || META.poses.wave;
      if (!p) return;
      this.pose = name;
      if (flip !== undefined) this.flip = flip;
      this.img.src = BASE + p.file + Q;
      this.el.querySelector(".tt-body").style.transform = this.flip ? "scaleX(-1)" : "";
      // 口の位置（画像に対する割合）
      const m = p.mouth;
      if (m) {
        this.mouth.style.display = "";
        this.mouth.style.left = (m.x - m.w / 2) * 100 + "%";
        const ar = META.size ? META.size[0] / META.size[1] : 640 / 720;   // 画像の横÷縦
        this.mouth.style.top = (m.y - m.w * 0.375 * ar) * 100 + "%";
        this.mouth.style.width = m.w * 100 + "%";
        this.mouth.style.setProperty("--skin", p.skin || "#fde7d9");
      } else this.mouth.style.display = "none";
      this.setMouth("n");
    }
    setMouth(v) {
      const k = MOUTH[v] ? v : "n";
      if (this._m === k) return;
      this._m = k;
      // 元の口を肌の色で隠してから、母音の口を描く
      this.mouth.innerHTML = `<ellipse cx="20" cy="15" rx="12" ry="9" fill="var(--skin)"/>` + MOUTH[k];
    }

    // 吹き出しに文字を出して話す。終わったら resolve
    async say(text, opts = {}) {
      await loadMeta();
      const my = ++this.speakId;
      this._text = text;
      if (this.audio) { this.audio.pause(); this.audio = null; }
      if (opts.pose) this.setPose(opts.pose, opts.flip);
      this.bubble.classList.remove("hidden");
      this.textEl.textContent = "";
      this.actEl.innerHTML = "";
      (opts.actions || []).forEach((a) => {
        const b = document.createElement("button");
        b.textContent = a.label;
        if (a.primary) b.className = "primary";
        if (a.link) b.className = "link";
        b.addEventListener("click", (e) => { e.stopPropagation(); a.fn(); });
        this.actEl.appendChild(b);
      });
      // 声：あらかじめ作った声 → その場で作る声 → 声なし（文字だけ）の順
      let vis = null, src = null;
      const line = opts.id && LINES[opts.id];
      if (line) { src = BASE + "voice/" + line.file + Q; vis = line.visemes; }
      else if (!muted() && opts.live !== false) {
        try {
          const j = await (await fetch("/api/tts?text=" + encodeURIComponent(text))).json();
          if (j.audio) { src = j.audio; vis = j.visemes; }
        } catch (e) { /* サーバーが無い（マニュアルのサイトなど） */ }
      }
      if (my !== this.speakId) return;
      if (!vis) vis = textVisemes(text);
      const dur = vis.length ? vis[vis.length - 1][1] + 0.2 : 1;
      let start = performance.now();
      const useAudio = src && !muted() && !opts.silent;   // silent：声を出さずに口と文字だけ動かす
      if (useAudio) {
        hushOthers(this);
        this.audio = new Audio(src);
        try { await this.audio.play(); start = performance.now(); } catch (e) { this.audio = null; }
      }
      return new Promise((resolve) => {
        const chars = [...text];
        const tick = () => {
          if (my !== this.speakId) return resolve();
          const t = this.audio ? this.audio.currentTime : (performance.now() - start) / 1000;
          // 文字を声の進みに合わせて出す
          const shown = Math.min(chars.length, Math.ceil(chars.length * Math.min(1, t / Math.max(0.3, dur - 0.2)) + 1));
          if (this.textEl.textContent.length !== shown) this.textEl.textContent = chars.slice(0, shown).join("");
          const cur = vis.find((x) => t >= x[0] && t < x[1]);
          this.setMouth(cur ? VOWEL[cur[2]] || cur[2] : "n");
          const ended = this.audio ? this.audio.ended || this.audio.paused && t > 0.1 : t >= dur;
          if (ended) { this.setMouth("n"); this.textEl.textContent = text; return resolve(); }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }
    stop() { this.speakId++; if (this.audio) this.audio.pause(); this.setMouth("n"); }
    // ほかの声・動画に譲って止まる（吹き出しは全文を出したまま。onYield で自動の続きを止めてもらう）
    yieldVoice() {
      this.stop();
      if (this._text) this.textEl.textContent = this._text;
      if (this.onYield) this.onYield();
    }
    // 話さずに、吹き出しに文字だけを出す
    show(text, opts = {}) {
      loadMeta().then(() => { if (opts.pose) this.setPose(opts.pose, opts.flip); });
      this.bubble.classList.remove("hidden");
      this.textEl.textContent = text;
      this.actEl.innerHTML = "";
      (opts.actions || []).forEach((a) => {
        const b = document.createElement("button");
        b.textContent = a.label; if (a.primary) b.className = "primary"; if (a.link) b.className = "link";
        b.addEventListener("click", (e) => { e.stopPropagation(); a.fn(); });
        this.actEl.appendChild(b);
      });
    }
    hideBubble() { this.bubble.classList.add("hidden"); }
    remove() { this.stop(); (this._walkTimers || []).forEach(clearInterval); this.el.remove(); ALL.delete(this); }

    // 画面の中を歩いて移動（floating のときだけ）
    walkTo(x, y) {
      return new Promise((resolve) => {
        const r = this.el.getBoundingClientRect();
        const dx = x - r.left, dy = y - r.top;
        const dist = Math.hypot(dx, dy);
        if (dist < 8) { resolve(); return; }
        const right = dx >= 0;
        const before = this.pose;
        const dur = Math.min(2600, Math.max(500, dist * 2.6));
        let f = 0;
        const flipFrames = setInterval(() => {
          const left = f++ % 2 === 0;
          this.setPose(left ? "walk1" : "walk2", !right);
          stepSound(left);   // 一歩ごとに、てくてくの音
        }, 170);
        // 足あと：半歩ごとに左右交互で足もとに置く
        let fl = false;
        const feet = setInterval(() => {
          const b = this.el.querySelector(".tt-body").getBoundingClientRect();
          footprint(b.left + b.width / 2, b.bottom - 6, Math.atan2(dy, dx) * 180 / Math.PI, (fl = !fl));
        }, 85);
        this._walkTimers = [flipFrames, feet];   // 途中でトトノちゃんが消されたら止める（remove）
        this.setPose("walk1", !right);
        this.hideBubble();
        this.el.style.transition = `left ${dur}ms linear, top ${dur}ms linear`;
        this.el.style.left = x + "px";
        this.el.style.top = y + "px";
        setTimeout(() => { clearInterval(flipFrames); clearInterval(feet); this.el.style.transition = ""; this.setPose(before && !before.startsWith("walk") ? before : "explain", false); resolve(); }, dur + 30);
      });
    }
    place(x, y) { this.el.style.left = x + "px"; this.el.style.top = y + "px"; }
  }

  // ==================================================================
  // ツアー（画面の中を歩きながら、順番に案内する）
  // ==================================================================
  const TOURS = {
    home: [
      { id: "tour_home_1", text: "こんにちは、トトノちゃんだよ！totonoumovie の使い方を案内するね。", pose: "wave" },
      { id: "tour_home_2", el: "#btnCreate3, #btnCreate2, #btnCreate", text: "動画を作るときは、ここを押してね。動画を選ぶだけで、AI が編集を進めてくれるよ。", pose: "point" },
      { id: "tour_home_3", el: "#projGrid", when: () => !!document.querySelector("#projGrid .pcard"), text: "作った動画は、ここに並ぶよ。クリックすると、編集画面が開くの。", pose: "point" },
      { id: "tour_home_4", el: "#btnAI", text: "AI の作業の様子と、確認待ちは、ここで見られるよ。赤い数字が付いたら、答えてあげてね。", pose: "point" },
      { id: "tour_home_5", el: "#btnPrompts", text: "毎回伝えたいことは、プロンプトに保存しておくと便利だよ。", pose: "explain" },
      { id: "tour_home_videos", el: "#btnVideos", text: "動画で見たいときは、ここを押してね。使い方動画が見られるよ。", pose: "point" },
      { id: "tour_home_7", el: "#btnCreate3, #btnCreate2, #btnCreate", text: "まずは、ここから動画を1本渡してみよう！わからなくなったら、右上のツアーで、いつでも呼んでね。", pose: "cheer" },
    ],
    editor: [
      { id: "tour_ed_1", text: "ここが編集画面だよ。AI が作った字幕や効果音を、見ながら直せるの。", pose: "wave" },
      { id: "tour_ed_2", el: "#side", text: "左の一覧で、字幕の文字をそのまま書き換えられるよ。", pose: "point" },
      { id: "tour_ed_3", el: "#stage", text: "まん中は、仕上がりの見本だよ。スペースキーで再生できるよ。", pose: "point" },
      { id: "tour_ed_4", el: "#timelineArea", text: "下のタイムラインは、ドラッグで動かして、端で長さを変えるの。空いている所をダブルクリックすると、追加できるよ。", pose: "explain" },
      { id: "tour_ed_5", el: "#inspector", text: "選んだものは、右側で細かく直せるよ。直した内容は、自動で保存されるから安心してね。", pose: "point" },
      { id: "tour_ed_6", el: "#sideTabs [data-t=cuts]", text: "カットは、ここで聞き比べて選ぶよ。切るかどうかを決めるのは、あなただよ。", pose: "think" },
      { id: "tour_ed_7", el: "#btnStill", text: "本当の見た目は、静止画で確かめてね。完成と同じ仕組みで作るよ。", pose: "point" },
      { id: "tour_ed_8", el: "#btnExport", text: "できたら、書き出しを押せば完成！がんばってね。", pose: "good" },
    ],
  };

  let tourChara = null, tourIdx = 0, tourSteps = [], spot = null;
  function ensureSpot() {
    if (spot) return spot;
    spot = document.createElement("div");
    spot.className = "tt-spot hidden";
    document.body.appendChild(spot);
    return spot;
  }
  async function showStep(i) {
    tourIdx = i;
    const st = tourSteps[i];
    if (!st) return endTour();
    // el は「,」区切りで先に書いたものを優先（見えているものだけ）
    const target = st.el ? st.el.split(",").map((q) => document.querySelector(q.trim())).find((e) => e && e.offsetParent !== null) : null;
    const s = ensureSpot();
    const W = innerWidth, H = innerHeight, cw = tourChara.size, ch = cw * 1.33, BW = 370;   // BW：吹き出しの幅＋すき間
    // 立つ位置 x,y（トトノちゃんの左上）と、吹き出しを左に出すか（bl）
    let x = W / 2 - (cw + BW) / 2, y = H / 2 - ch / 2, bl = false, stack = false;
    const r = target && target.getBoundingClientRect();
    if (r) {
      s.classList.remove("hidden");
      Object.assign(s.style, { left: r.left - 6 + "px", top: r.top - 6 + "px", width: r.width + 12 + "px", height: r.height + 12 + "px" });
      y = r.top + r.height / 2 - ch / 2;
      const fitL = r.left - cw - 12 - BW >= 8, fitR = r.right + 12 + cw + BW <= W - 8;   // 体＋吹き出しが横に入るか
      const bodyL = r.left - cw - 12 >= 8, bodyR = r.right + 12 + cw <= W - 8;            // 体だけなら入るか
      if (r.width <= W * 0.6 && fitL) { x = r.left - cw - 12; bl = true; }        // 相手の左に立ち、吹き出しはさらに左
      else if (r.width <= W * 0.6 && fitR) { x = r.right + 12; }                  // 相手の右に立ち、吹き出しはさらに右
      else if (r.width <= W * 0.6 && (bodyL || bodyR)) {
        // 横に吹き出しまでは入らない（編集画面の見本など）：体は相手の横、吹き出しは体の上に出す
        stack = true; bl = bodyL; x = bodyL ? r.left - cw - 12 : r.right + 12;
        y = r.top + r.height / 2 - ch / 2 + 70;
      } else {
        // 横に長い相手（タイムラインなど）：上か下の右寄りに立ち、吹き出しは左
        x = W - cw - 30; bl = true;
        y = r.top - ch - 12 >= 56 ? r.top - ch - 12 : r.bottom + 12;
      }
    } else {
      s.classList.add("hidden");
      // 指す相手が無いときは、ホームのトトノちゃんと同じ場所に立つ（大きなボタンを隠さない）
      const home = document.querySelector("#welcomeChara .tt-body");
      if (home && home.offsetParent !== null) { const hr = home.getBoundingClientRect(); x = hr.left; y = hr.bottom - ch; }
    }
    // 画面の外に出ない
    if (stack) { x = Math.max(8, Math.min(W - cw - 8, x)); y = Math.max(200, Math.min(H - ch - 10, y)); }
    else { x = Math.max(bl ? BW : 8, Math.min(W - cw - (bl ? 8 : BW), x)); y = Math.max(56, Math.min(H - ch - 10, y)); }
    tourChara.el.classList.toggle("tt-stack", stack);
    // 吹き出しを上に出すときは、画面からはみ出さない幅にする
    tourChara.bubble.style.width = stack ? Math.min(BW - 30, bl ? x + cw - 8 : W - 8 - x) + "px" : "";
    tourChara.el.classList.toggle("tt-bl", bl);
    await tourChara.walkTo(x, y);
    if (!tourChara || tourIdx !== i) return;   // 歩いている間にツアーが閉じられた・次へ進んだ
    // 指さしの絵は右を指すので、相手がトトノちゃんより左にあるときは左右を反転
    const flip = st.pose === "point" && !!r && r.left + r.width / 2 < x + cw / 2;
    tourChara.say(st.text, {
      id: st.id, pose: st.pose, flip,
      actions: [
        ...(i > 0 ? [{ label: "← 戻る", fn: () => showStep(i - 1) }] : []),
        { label: i === tourSteps.length - 1 ? "おわる" : "次へ →", primary: true, fn: () => showStep(i + 1) },
        { label: "閉じる", fn: endTour },
      ],
    });
  }
  function startTour(name) {
    endTour();
    // 指す相手が今の画面に見えていない手順は飛ばす（0件のときの「AI」「プロンプト」など）
    const visible = (sel) => sel.split(",").some((q) => { const e = document.querySelector(q.trim()); return e && e.offsetParent !== null; });
    tourSteps = (TOURS[name] || TOURS.home).filter((st) => (!st.when || st.when()) && (!st.el || visible(st.el)));
    document.body.classList.add("touring");
    tourChara = new Chara(document.body, { floating: true, size: 170, pose: "wave" });
    tourChara.place(innerWidth / 2 - 85, innerHeight + 10);
    try { localStorage.setItem("totono-tour-" + name, "1"); } catch (e) { /* 無視 */ }
    showStep(0);
  }
  function endTour() {
    const was = !!tourChara;
    if (tourChara) { tourChara.remove(); tourChara = null; }
    if (spot) spot.classList.add("hidden");
    document.body.classList.remove("touring");
    if (was && window.onTotonoTourEnd) window.onTotonoTourEnd();
  }
  function tourSeen(name) { try { return localStorage.getItem("totono-tour-" + name) === "1"; } catch (e) { return true; } }

  window.Totono = { Chara, startTour, endTour, tourSeen, loadMeta, isMuted: muted, setMuted };
})();
