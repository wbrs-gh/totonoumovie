/* totonoumovie 使い方マニュアル：共通の動き */
(function () {
  "use strict";
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  // いつやったかの表示（例：10/19（日）7:52 にできた）。前の版で付けたチェック（日時なし）は「済み」だけ出す
  function whenText(v, verb) {
    var t = typeof v === "string" ? new Date(v) : null;
    if (!t || isNaN(t)) return "✓ " + verb + "済み";
    var wd = "日月火水木金土".charAt(t.getDay());
    var y = t.getFullYear() !== new Date().getFullYear() ? t.getFullYear() + "/" : "";
    return "✓ " + y + (t.getMonth() + 1) + "/" + t.getDate() + "（" + wd + "）" + t.getHours() + ":" + ("0" + t.getMinutes()).slice(-2) + " に" + verb;
  }
  function toast(msg) {
    var t = $(".toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 1800);
  }

  // ---- Mac / Windows（全ページで覚える） ----
  var os = store("tm-os") || (/Win/.test(navigator.platform) ? "win" : "mac");
  function setOS(v) {
    os = v; store("tm-os", v);
    document.body.classList.toggle("os-win", v === "win");
    $$(".os-switch button, .os-pick button").forEach(function (b) { b.classList.toggle("on", b.dataset.os === v); });
    $$(".os-pick .now").forEach(function (n) { n.textContent = v2name(v) + " の手順を表示中"; });
  }
  // ページの中の大きな切り替え（<div class="os-pick"></div> を置いた場所に出す）
  $$(".os-pick").forEach(function (box) {
    var mini = box.classList.contains("mini");
    box.innerHTML = (mini ? "" : '<div class="q">あなたのパソコンは？</div>') +
      '<div class="seg"><button type="button" data-os="mac"><span class="ic">🍎</span>Mac</button><button type="button" data-os="win"><span class="ic">🪟</span>Windows</button></div>' +
      '<div class="now"></div>';
    $$("button", box).forEach(function (b) { b.addEventListener("click", function () { setOS(b.dataset.os); toast(v2name(b.dataset.os) + " の手順に切り替えました"); }); });
  });
  $$(".os-switch button").forEach(function (b) { b.addEventListener("click", function () { setOS(b.dataset.os); toast(v2name(b.dataset.os) + " の手順を表示しています"); }); });
  function v2name(v) { return v === "win" ? "Windows" : "Mac"; }
  setOS(os);

  // ---- スマホの目次 ----
  $(".menu-btn").addEventListener("click", function () {
    var open = document.body.classList.toggle("menu-open");
    this.setAttribute("aria-expanded", open);
  });

  // ---- コマンドのコピー ----
  $$(".cmd").forEach(function (box) {
    var pre = $("pre", box);
    var b = document.createElement("button");
    b.className = "copy"; b.type = "button"; b.textContent = "コピー";
    b.addEventListener("click", function () {
      var text = pre.innerText.replace(/\n$/, "");
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () {
        b.textContent = "✓ コピーしました"; b.classList.add("done");
        setTimeout(function () { b.textContent = "コピー"; b.classList.remove("done"); }, 1800);
      }, function () {
        var r = document.createRange(); r.selectNodeContents(pre);
        var s = getSelection(); s.removeAllRanges(); s.addRange(r);
        toast("選んだ状態にしました。⌘C（Windows は Ctrl+C）でコピーしてください");
      });
    });
    box.appendChild(b);
  });

  // ---- 手順のチェック（ページごとに覚える） ----
  $$("[data-progress]").forEach(function (wrap) {
    var key = "tm-done-" + wrap.dataset.progress;
    var done = {};
    try { done = JSON.parse(store(key) || "{}"); } catch (e) { done = {}; }
    var steps = function () { return $$(".step[data-id]", wrap).filter(function (s) { return s.offsetParent !== null; }); };
    var bar = document.createElement("div");
    bar.className = "progress";
    bar.innerHTML = '<div class="bar"><i></i></div><div class="txt"><span class="c"></span><a href="#" class="reset">チェックを消す</a></div>';
    wrap.insertBefore(bar, wrap.firstChild);
    function update() {
      // 見えている手順に、見出しごとに 1 から番号を振り直す（Mac／Windows で手順の数が違うため）
      $$("section", wrap).forEach(function (sec) {
        var n = 0;
        var lt = $("h2 .num", sec), pre = lt ? lt.textContent.trim() + "-" : "";
        $$(".step", sec).forEach(function (s) { if (s.offsetParent !== null) { s.setAttribute("data-n", pre + (++n)); s.classList.toggle("long-n", !!pre); } });
      });
      var list = steps(), n = list.filter(function (s) { return done[s.dataset.id]; }).length;
      $(".bar i", bar).style.width = (list.length ? n / list.length * 100 : 0) + "%";
      $(".c", bar).textContent = n === list.length && n ? "🎉 ぜんぶ終わりました！" : "できた " + n + " ／ " + list.length;
    }
    $$(".step[data-id]", wrap).forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "done-btn"; b.textContent = "できた";
      s.appendChild(b);
      var when = document.createElement("span");
      when.className = "done-when";
      s.appendChild(when);
      function mark() { when.textContent = done[s.dataset.id] ? whenText(done[s.dataset.id], "できた") : ""; }
      if (done[s.dataset.id]) s.classList.add("done");
      mark();
      b.addEventListener("click", function () {
        if (done[s.dataset.id]) delete done[s.dataset.id]; else done[s.dataset.id] = new Date().toISOString();
        s.classList.toggle("done", !!done[s.dataset.id]);
        mark();
        store(key, JSON.stringify(done)); update();
        if (done[s.dataset.id]) {
          var next = steps().filter(function (x) { return !done[x.dataset.id]; })[0];
          if (next) setTimeout(function () { next.scrollIntoView({ behavior: "smooth", block: "start" }); }, 250);
        }
      });
    });
    $(".reset", bar).addEventListener("click", function (e) {
      e.preventDefault(); done = {}; store(key, "{}");
      $$(".step", wrap).forEach(function (s) { s.classList.remove("done"); });
      $$(".done-when", wrap).forEach(function (w) { w.textContent = ""; }); update();
    });
    $$(".os-switch button, .os-pick button").forEach(function (b) { b.addEventListener("click", update); });
    update();
  });

  // ---- 用語の説明（ふきだし） ----
  var pop = null;
  function hideTip() { if (pop) { pop.remove(); pop = null; } }
  $$(".term").forEach(function (t) {
    t.tabIndex = 0;
    function show() {
      hideTip();
      pop = document.createElement("div"); pop.className = "tip-pop"; pop.textContent = t.dataset.tip;
      document.body.appendChild(pop);
      var r = t.getBoundingClientRect();
      pop.style.left = Math.max(10, Math.min(innerWidth - pop.offsetWidth - 10, r.left + scrollX)) + "px";
      pop.style.top = (r.bottom + scrollY + 8) + "px";
    }
    t.addEventListener("mouseenter", show); t.addEventListener("focus", show);
    t.addEventListener("mouseleave", hideTip); t.addEventListener("blur", hideTip);
    t.addEventListener("click", show);
  });

  // ---- このページの見出し（右側） ----
  var toc = $(".toc"), hs = $$(".main h2[id]");
  if (toc && hs.length > 1) {
    toc.innerHTML = "<b>このページ</b>" + hs.map(function (h) { var c = h.cloneNode(true); $$(".num", c).forEach(function (n) { n.remove(); }); return '<a href="#' + h.id + '">' + c.textContent.trim() + "</a>"; }).join("");
    var links = $$("a", toc);
    var onScroll = function () {
      var cur = 0;
      hs.forEach(function (h, i) { if (h.getBoundingClientRect().top < 140) cur = i; });
      links.forEach(function (a, i) { a.classList.toggle("on", i === cur); });
    };
    addEventListener("scroll", onScroll, { passive: true }); onScroll();
  }

  // ---- 動画のチャプター ----
  $$("[data-chapters]").forEach(function (meta) {
    var v = document.getElementById(meta.dataset.chapters);
    $$(".chap", meta).forEach(function (b) {
      b.addEventListener("click", function () { v.currentTime = +b.dataset.t; v.play(); });
    });
  });

  // ---- 検索 ----
  var sp = $(".search-pop"), si = $(".search-box input"), sh = $(".search-hits"), sel = 0;
  function norm(s) { return (s || "").toLowerCase().replace(/[ァ-ン]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); }); }
  function openSearch() { sp.hidden = false; si.value = ""; render(); si.focus(); }
  function closeSearch() { sp.hidden = true; }
  function render() {
    var q = norm(si.value.trim());
    var words = q.split(/\s+/).filter(Boolean);
    var data = window.TM_SEARCH || [];
    var hits = [];
    if (!words.length) {
      sh.innerHTML = '<div class="search-tip">例：「カット　戻す」「Timed out」「BGM」「マイスタイル」「Windows　入れかた」</div>';
      return;
    }
    data.forEach(function (d) {
      var hay = norm(d.t + " " + d.h + " " + d.x), score = 0, ok = true;
      words.forEach(function (w) { var i = hay.indexOf(w); if (i < 0) ok = false; else score += (norm(d.h).indexOf(w) >= 0 ? 5 : 0) + (norm(d.t).indexOf(w) >= 0 ? 3 : 0) + 1; });
      if (ok) hits.push({ d: d, s: score });
    });
    hits.sort(function (a, b) { return b.s - a.s; });
    sel = 0;
    sh.innerHTML = hits.slice(0, 30).map(function (h, i) {
      var d = h.d, x = d.x, w = words[0], i0 = norm(x).indexOf(w);
      var ex = i0 >= 0 ? x.slice(Math.max(0, i0 - 30), i0 + 70) : x.slice(0, 90);
      ex = ex.replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; });
      words.forEach(function (w) { if (w) ex = ex.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), function (m) { return "<mark>" + m + "</mark>"; }); });
      return '<a href="' + d.p + ".html" + (d.a ? "#" + d.a : "") + '"' + (i === 0 ? ' class="sel"' : "") + "><small>" + d.t + "</small>" + (d.h || d.t) + '<div class="ex">…' + ex + "…</div></a>";
    }).join("") || '<div class="search-tip">見つかりませんでした。別の言葉で試すか、「困ったとき」のページを見てください。</div>';
  }
  $(".search-btn").addEventListener("click", openSearch);
  si.addEventListener("input", render);
  sp.addEventListener("mousedown", function (e) { if (e.target === sp) closeSearch(); });
  addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSearch(); return; }
    if (e.key === "/" && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); openSearch(); return; }
    if (sp.hidden) return;
    var items = $$("a", sh);
    if (e.key === "Escape") closeSearch();
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(1, items.length);
      items.forEach(function (a, i) { a.classList.toggle("sel", i === sel); }); if (items[sel]) items[sel].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && items[sel]) { location.href = items[sel].href; }
  });
  // ---- トトノちゃんのひとこと（押すと声で説明） ----
  $$(".tt-tip").forEach(function (tip) {
    var text = tip.textContent.trim(), pose = tip.dataset.pose || "explain", id = tip.dataset.id;
    tip.textContent = "";
    if (!window.Totono) { tip.textContent = text; return; }
    var c = new Totono.Chara(tip, { size: 120, pose: pose });
    var play = function () { c.say(text, { id: id, pose: pose, live: false, actions: [{ label: "▶ もう一度聞く", fn: play }] }); };
    c.show(text, { pose: pose, actions: [{ label: "▶ トトノちゃんの説明を聞く", primary: true, fn: play }] });
    c.onClick = play;
  });


  // ---- 図の案内：トトノちゃんが図の下を歩いて、順番に指さして説明する ----
  // <div class="fig-svg" data-guide='[{"s":1,"x":12,"pose":"point","id":"..","t":".."}]'> と <g class="gs" data-s="1">
  var voiceOn = store("tm-guide-voice") === "1";
  function guide(fig) {
    var steps; try { steps = JSON.parse(fig.dataset.guide); } catch (e) { return; }
    if (!steps.length || !window.Totono) return;
    var svg = $("svg", fig), groups = $$(".gs", fig);
    fig.classList.add("guided");
    fig.classList.add("pre");   // 案内が始まるまでは、全体を見せておく
    var band = document.createElement("div"); band.className = "gband"; fig.appendChild(band);
    var ctl = document.createElement("div"); ctl.className = "gctl";
    ctl.innerHTML = '<button type="button" class="gprev" aria-label="前へ">◀</button><span class="gdots"></span><button type="button" class="gnext" aria-label="次へ">▶</button>' +
      '<button type="button" class="gvoice"></button><button type="button" class="greplay">↻ はじめから</button>';
    fig.appendChild(ctl);
    var dots = $(".gdots", ctl);
    steps.forEach(function (st, i) { var d = document.createElement("button"); d.type = "button"; d.setAttribute("aria-label", (i + 1) + "番目"); d.addEventListener("click", function () { stopAuto(); go(i, true); }); dots.appendChild(d); });
    var small = innerWidth < 640;
    var c = new Totono.Chara(band, { size: small ? 78 : 104, pose: "stand" });
    var cur = -1, timer = null, auto = false, walking = null, xNow = null;
    function setVoiceBtn() { $(".gvoice", ctl).textContent = voiceOn ? "🔊 声あり" : "🔈 声で聞く"; }
    setVoiceBtn();
    function show(i) {
      groups.forEach(function (g) {
        var n = +g.dataset.s;
        g.classList.toggle("on", n <= steps[i].s);
        g.classList.toggle("cur", n === steps[i].s);
      });
      fig.classList.toggle("done", i === steps.length - 1);
      $$("button", dots).forEach(function (d, j) { d.classList.toggle("on", j === i); d.classList.toggle("past", j < i); });
    }
    // 帯の中で、x（図の横の％）の下まで歩く
    function walkTo(x) {
      return new Promise(function (res) {
        var bw = band.clientWidth, cw = c.el.querySelector(".tt-body").offsetWidth;
        var target = Math.max(0, Math.min(bw - cw, bw * x / 100 - cw * 0.5));
        var right = target >= (xNow === null ? target : xNow);
        // 図の右側を説明するときは吹き出しを左に、左側なら右に
        c.el.classList.toggle("bl", x > 55);
        if (xNow === null || Math.abs(target - xNow) < 6) { c.el.style.left = target + "px"; xNow = target; return res(); }
        var dur = Math.min(1800, Math.max(500, Math.abs(target - xNow) * 3));
        var f = 0; c.hideBubble();
        clearInterval(walking);
        walking = setInterval(function () { c.setPose(f++ % 2 ? "walk2" : "walk1", !right); }, 160);
        c.el.style.transition = "left " + dur + "ms linear"; c.el.style.left = target + "px"; xNow = target;
        setTimeout(function () { clearInterval(walking); c.el.style.transition = ""; res(); }, dur);
      });
    }
    var scroller = svg && svg.parentNode.classList.contains("gscroll") ? svg.parentNode : null;
    function narrow() { return scroller && scroller.scrollWidth > scroller.clientWidth + 4; }
    // スマホ：説明している部分が見えるように、図を横に送る
    function follow(st) {
      if (!narrow()) return;
      var g = $$(".gs", fig).filter(function (x) { return +x.dataset.s === st.s; })[0], cx;
      if (g && g.getBBox) {
        var b = g.getBBox(), vb = svg.viewBox.baseVal, k = svg.clientWidth / (vb && vb.width || svg.clientWidth);
        cx = (b.x + b.width / 2) * k;
      } else cx = svg.clientWidth * (st.x == null ? 50 : st.x) / 100;
      scroller.scrollTo({ left: Math.max(0, cx - scroller.clientWidth / 2), behavior: "smooth" });
    }
    function go(i, byHand) {
      if (i < 0 || i >= steps.length) return;
      cur = i; var st = steps[i], my = ++go.n;
      show(i);
      follow(st);
      (narrow() ? Promise.resolve(c.el.style.left = "0px") : walkTo(st.x == null ? 50 : st.x)).then(function () {
        if (my !== go.n) return;
        // 指さすときは、説明する場所の方を向く
        var bw = band.clientWidth, mid = xNow + c.el.querySelector(".tt-body").offsetWidth / 2;
        var flip = !narrow() && st.pose === "point" && bw * st.x / 100 < mid - 10;
        c.say(st.t, { id: st.id, pose: st.pose || "explain", flip: flip, silent: !voiceOn, live: false }).then(function () {
          if (my !== go.n || !auto) return;
          if (i + 1 < steps.length) timer = setTimeout(function () { go(i + 1); }, voiceOn ? 500 : 1400);
          else { auto = false; }
        });
      });
    }
    go.n = 0;
    function stopAuto() { auto = false; clearTimeout(timer); }
    function play(from) { fig.classList.remove("pre"); stopAuto(); auto = true; go(from || 0); }
    $(".gnext", ctl).addEventListener("click", function () { fig.classList.remove("pre"); stopAuto(); go(Math.min(steps.length - 1, cur + 1), true); });
    $(".gprev", ctl).addEventListener("click", function () { stopAuto(); go(Math.max(0, cur - 1), true); });
    $(".greplay", ctl).addEventListener("click", function () { play(0); });
    $(".gvoice", ctl).addEventListener("click", function () { voiceOn = !voiceOn; store("tm-guide-voice", voiceOn ? "1" : "0"); setVoiceBtn(); if (voiceOn) play(Math.max(0, cur)); else c.stop(); });
    c.onClick = function () { stopAuto(); go(cur < 0 ? 0 : cur, true); };
    c.onYield = stopAuto;   // ほかの声・動画が始まったら、自動で次へ進むのをやめる
    // 最初は1つ目だけ見せておき、図が画面に入ったら自動で始める
    show(0);
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { io.disconnect(); setTimeout(function () { play(0); }, 300); } }); }, { threshold: 0.55 });
      io.observe(svg || fig);
    } else play(0);
  }
  // スマホでは図が小さくなりすぎるので、横にスクロールして見る
  $$(".fig-svg > svg").forEach(function (svg) {
    var w = document.createElement("div"); w.className = "gscroll";
    svg.parentNode.insertBefore(w, svg); w.appendChild(svg);
  });
  $$(".fig-svg[data-guide]").forEach(guide);

  // ---- トップの最初の画面：大きなトトノちゃん ----
  $$("[data-tt-hero]").forEach(function (st) {
    var text = st.textContent.trim(); st.textContent = "";
    if (!window.Totono) return;
    var c = new Totono.Chara(st, { size: innerWidth < 860 ? 170 : 260, pose: st.dataset.pose || "wave" });
    var play = function () { voiceOn = true; store("tm-guide-voice", "1"); c.say(text, { id: st.dataset.id, pose: "wave", live: false, actions: [{ label: "▶ もう一度", fn: play }] }); };
    setTimeout(function () { c.say(text, { id: st.dataset.id, pose: "wave", silent: true, live: false, actions: [{ label: "🔊 声で聞く", primary: true, fn: play }] }); }, 700);
    c.onClick = play;
  });

  // ---- スクロールすると、ふわっと出てくる ----
  if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    var rv = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); rv.unobserve(e.target); } }); }, { threshold: 0.12 });
    $$(".main > section > h2, .main .card, .main .route a, .main .step, .main .callout, .main .fig-svg, .main .video, .main .tbl, .main .ba, .main .vcard, .main .tt-tip").forEach(function (el, i) {
      if (el.getBoundingClientRect().top < innerHeight) return;   // 最初から見えているものはそのまま
      el.classList.add("reveal"); rv.observe(el);
    });
  }


  // ---- 動画で見る：上の画面で再生し、トトノちゃんが案内する ----
  (function () {
    var dataEl = $("#vdata"), player = $("#vmain");
    if (!dataEl || !player) return;
    var list = JSON.parse(dataEl.textContent);
    var vis = function () { return list.filter(function (it) { var el = document.getElementById(it.v); return el && el.offsetParent !== null; }); };
    var host = $("[data-vguide]"), c = window.Totono ? new Totono.Chara(host, { size: innerWidth < 860 ? 90 : 120, pose: "wave" }) : null;
    var curV = null;
    function load(v, playNow, talk) {
      var it = list.filter(function (x) { return x.v === v; })[0]; if (!it) return;
      curV = it;
      player.poster = "videos/" + it.f + ".jpg"; player.src = "videos/" + it.f + ".mp4";
      $(".vno").textContent = "動画 " + (list.indexOf(it) + 1);
      $(".vtitle").textContent = it.t; $(".vdesc").textContent = it.d;
      $$(".vcard").forEach(function (a) { a.classList.toggle("on", a.dataset.v === v); });
      if (playNow) player.play().catch(function () {});
      if (c && talk) c.say(it.line, { id: it.id, pose: "point", silent: !voiceOn || playNow, live: false });
    }
    $$(".vcard").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault(); history.replaceState(null, "", "#" + a.dataset.v);
        load(a.dataset.v, true, true);
        $(".vplayer-wrap").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    // 見終わったら、次の動画をすすめる
    player.addEventListener("ended", function () {
      var vs = vis(), i = vs.indexOf(curV), nx = vs[i + 1];
      if (!c) return;
      if (nx) c.say("見てくれてありがとう！次は「" + nx.t + "」だよ。", { pose: "cheer", silent: true, live: false, actions: [{ label: "▶ 次を見る", primary: true, fn: function () { load(nx.v, true, false); } }] });
      else c.say("全部見てくれてありがとう！あとは実際に1本作ってみてね。", { pose: "good", silent: true, live: false, actions: [{ label: "はじめての1本へ →", primary: true, fn: function () { location.href = "first.html"; } }] });
    });
    var start = (location.hash || "").slice(1);
    var first = list.some(function (x) { return x.v === start; }) ? start : (vis()[0] || list[0]).v;
    load(first, false, false);
    if (c) setTimeout(function () { c.say(curV.line, { id: curV.id, pose: "wave", silent: true, live: false, actions: [{ label: "🔊 声で聞く", fn: function () { voiceOn = true; store("tm-guide-voice", "1"); c.say(curV.line, { id: curV.id, pose: "point", live: false }); } }] }); }, 500);
    $$(".os-switch button, .os-pick button").forEach(function (b) { b.addEventListener("click", function () { if (curV && (curV.v === "v02" || curV.v === "v03")) load(b.dataset.os === "win" ? "v03" : "v02", false, false); }); });
  })();

  // ---- 画面の写真は、押すと大きく見られる ----
  $$(".main figure img").forEach(function (img) {
    img.classList.add("zoomable"); img.title = "押すと大きく見られます";
    img.addEventListener("click", function () {
      var box = document.createElement("div"); box.className = "lightbox";
      box.innerHTML = '<img alt=""><span>押すと閉じます</span>'; $("img", box).src = img.currentSrc || img.src; $("img", box).alt = img.alt;
      box.addEventListener("click", function () { box.remove(); });
      document.body.appendChild(box);
    });
  });
  // チェックリストの文は1つにまとめる（文が列に割れないように）
  // チェックは、ページごとに日時つきで覚えておく（次に開いたときも残る）
  var ckKey = "tm-check-" + (location.pathname.split("/").pop() || "index.html");
  var ck = {};
  try { ck = JSON.parse(store(ckKey) || "{}") || {}; } catch (e) { ck = {}; }
  $$(".checklist label").forEach(function (l, i) {
    var inp = $("input", l); if (!inp) return;
    var sp = document.createElement("span");
    while (inp.nextSibling) sp.appendChild(inp.nextSibling);
    l.appendChild(sp);
    var id = sp.textContent.replace(/\s+/g, " ").trim().slice(0, 40) || "c" + i, when = document.createElement("small");
    when.className = "done-when";
    sp.appendChild(when);
    function mark() { inp.checked = !!ck[id]; when.textContent = ck[id] ? whenText(ck[id], "用意した") : ""; }
    mark();
    inp.addEventListener("change", function () {
      if (inp.checked) ck[id] = new Date().toISOString(); else delete ck[id];
      store(ckKey, JSON.stringify(ck)); mark();
    });
  });

  // ---- 動画の再生の速さ（1倍／1.25倍／1.5倍／2倍。選んだ速さは覚えておく） ----
  var RATES = [1, 1.25, 1.5, 2];
  function curRate() { var r = parseFloat(store("tm-video-rate")); return RATES.indexOf(r) >= 0 ? r : 1; }
  function applyRate(r) {
    store("tm-video-rate", String(r));
    $$("video").forEach(function (v) { v.playbackRate = r; v.defaultPlaybackRate = r; });
    $$(".rate-bar button").forEach(function (b) { b.classList.toggle("on", +b.dataset.r === r); });
  }
  $$(".video").forEach(function (box) {
    var bar = document.createElement("div"); bar.className = "rate-bar";
    bar.innerHTML = '<span>再生の速さ</span>' + RATES.map(function (r) { return '<button type="button" data-r="' + r + '">' + r + '倍</button>'; }).join("");
    box.parentNode.insertBefore(bar, box.nextSibling);
    $$("button", bar).forEach(function (b) { b.addEventListener("click", function () { applyRate(+b.dataset.r); }); });
  });
  // 動画を読み込み直したり切り替えたりしても、同じ速さのまま
  $$("video").forEach(function (v) { v.addEventListener("loadedmetadata", function () { v.playbackRate = curRate(); }); v.addEventListener("play", function () { if (v.playbackRate !== curRate()) v.playbackRate = curRate(); }); });
  applyRate(curRate());

  window.TM = { toast: toast, store: store };
})();
