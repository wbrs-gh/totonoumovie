/* totonoumovie 編集画面の本体（プレビュー・重ね表示・タイムライン・プロパティ） */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r3 = (v) => Math.round(v * 1000) / 1000;

async function api(path, body) {
  const opt = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const res = await fetch(path, opt);
  let j = {};
  try { j = await res.json(); } catch (e) { /* 空 */ }
  if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}

function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), ms);
}

function fmt(sec) {
  if (sec == null || isNaN(sec)) return "-";
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

function openModal(html, opts = {}) {
  $("#modalBody").innerHTML = html;
  $("#modalBox").style.width = opts.width || "";
  $("#modal").classList.remove("hidden");
  return $("#modalBody");
}
function closeModal() {
  $$("#modalBody video").forEach((v) => v.pause());
  // AI の作業画面のトトノちゃんが話していたら止める
  if (typeof runView !== "undefined" && runView && runView.chara) runView.chara.stop();
  $("#modal").classList.add("hidden");
  $("#modalBody").innerHTML = "";
}
$("#modal").addEventListener("mousedown", (e) => { if (e.target.id === "modal") closeModal(); });

// ======================================================================
// 状態
// ======================================================================
const S = {
  status: null,
  projects: [],
  P: null,          // プロジェクト名
  proj: null,       // /api/project の中身
  data: {},         // key → items
  cuts: [],         // 正規化したカット区間
  sel: null,        // {key, idx}
  undo: [], redo: [],
  dirty: new Set(),
  pps: 40,          // 1秒あたりのピクセル
  dur: 10,
  wave: null,
};

const LANES = [
  { key: "transcript", label: "文字起こし", ro: true },
  { key: "cut", label: "カット", ro: true },
  { key: "telop", label: "字幕" },
  { key: "se", label: "効果音" },
  { key: "zoom", label: "寄り" },
  { key: "motion", label: "モーション" },
  { key: "image", label: "画像" },
  { key: "section", label: "章タイトル" },
  { key: "chapterCard", label: "章カード" },
  { key: "bgm", label: "BGM", ro: true },
];

const KEY_LABEL = { telop: "字幕", se: "効果音", zoom: "寄り", motion: "モーション", image: "画像", section: "章タイトル", chapterCard: "章カード", cut: "カット", transcript: "文字起こし", bgm: "BGM" };

// 項目の開始・終了（種類で持ち方が違う）
function itemStart(key, it) { return key === "chapterCard" ? +it.atSec || 0 : +it.startSec || 0; }
function itemEnd(key, it) {
  if (key === "se") return (+it.startSec || 0) + (+it.durationSec || 0.8);
  if (key === "chapterCard") return (+it.atSec || 0) + (+it.durationSec || 2.4);
  return +it.endSec || itemStart(key, it) + 1;
}
function setStart(key, it, v) { if (key === "chapterCard") it.atSec = r3(v); else it.startSec = r3(v); }
function setEnd(key, it, v) {
  const s = itemStart(key, it);
  if (key === "se") it.durationSec = r3(Math.max(0.1, v - s));
  else if (key === "chapterCard") it.durationSec = r3(Math.max(0.5, v - s));
  else it.endSec = r3(Math.max(s + 0.1, v));
}

// ======================================================================
// カットと時刻の換算
// ======================================================================
function normalizeCuts(items) {
  const a = items.filter((c) => c.startSec != null && c.endSec != null).map((c) => ({ s: +c.startSec, e: +c.endSec })).sort((x, y) => x.s - y.s);
  const out = [];
  for (const c of a) {
    const l = out[out.length - 1];
    if (l && c.s <= l.e + 1e-3) l.e = Math.max(l.e, c.e); else out.push({ ...c });
  }
  return out;
}
function cutAt(t) { return S.cuts.find((c) => t >= c.s && t < c.e) || null; }
function toEdited(t) {
  let removed = 0;
  for (const c of S.cuts) {
    if (t >= c.e) removed += c.e - c.s;
    else if (t > c.s) return c.s - removed;
    else break;
  }
  return t - removed;
}
function editedDuration() { return toEdited(S.dur); }

// ======================================================================
// 画面の切り替え（ホーム／編集）
// ======================================================================
function showHome() {
  S.P = null; S.proj = null;
  document.body.classList.add("home-mode");
  $("#home").classList.remove("hidden");
  $("#editor").classList.add("hidden");
  $("#timelineArea").classList.add("hidden");
  $$(".needp").forEach((b) => (b.disabled = true));
  $("#projName").textContent = "";
  $("#video").pause();
  history.replaceState(null, "", "/");
  window.renderHome && window.renderHome();
  window.maybeAutoTour && window.maybeAutoTour("home");
}

async function openProject(name, opts = {}) {
  await flushSave();
  const proj = await api("/api/project?p=" + encodeURIComponent(name));
  const changed = S.P !== name;
  S.P = name;
  S.proj = proj;
  S.data = proj.data;
  for (const k of Object.keys(S.data)) if (!Array.isArray(S.data[k])) delete S.data[k];
  S.cuts = normalizeCuts(S.data.cut || []);
  S.dur = proj.media?.dur || proj.config?.durationSec || 10;
  if (changed) { S.sel = null; S.undo = []; S.redo = []; S.wave = null; }
  document.body.classList.remove("home-mode", "home-empty");
  $("#home").classList.add("hidden");
  $("#editor").classList.remove("hidden");
  $("#timelineArea").classList.remove("hidden");
  $$(".needp").forEach((b) => (b.disabled = false));
  $("#projName").textContent = proj.title + (proj.config?.format ? `（${proj.config.format}）` : "");
  history.replaceState(null, "", "/?p=" + encodeURIComponent(name));
  fillProjSelect();
  if (changed || opts.reloadVideo) loadVideo();
  layoutStage();
  renderTimeline();
  renderInspector();
  window.renderSide && window.renderSide();
  if (changed || !S.wave) loadWave();
  if (changed) window.maybeAutoTour && window.maybeAutoTour("editor");
}

function fillProjSelect() {
  const sel = $("#projSelect");
  sel.innerHTML = `<option value="">（プロジェクトを選ぶ）</option>` +
    S.projects.map((p) => `<option value="${esc(p.name)}" ${p.name === S.P ? "selected" : ""}>${esc(p.title)}</option>`).join("");
}
$("#projSelect").addEventListener("change", (e) => { if (e.target.value) openProject(e.target.value); else showHome(); });
$("#btnHome").addEventListener("click", () => { flushSave(); showHome(); });

// ======================================================================
// プレビュー（動画＋重ね表示）
// ======================================================================
const video = $("#video");

function loadVideo() {
  video.poster = "/api/frame?p=" + encodeURIComponent(S.P) + "&t=0.5";
  video.src = "/api/video?p=" + encodeURIComponent(S.P) + "&v=" + Date.now();
  video.currentTime = 0;
  pollProxy();
}
async function pollProxy() {
  const P = S.P;
  if (!P) return;
  try {
    const j = await api("/api/proxy_status?p=" + encodeURIComponent(P));
    if (P !== S.P) return;
    if (j.ready) {
      if ($("#proxyState").textContent) {
        $("#proxyState").textContent = "";
        const t = video.currentTime;
        video.src = "/api/video?p=" + encodeURIComponent(P) + "&v=" + Date.now();
        video.currentTime = t;
      }
    } else {
      $("#proxyState").textContent = "⏳ 軽い再生用の動画を準備中（そのままでも再生できます）";
      setTimeout(pollProxy, 3000);
    }
  } catch (e) { /* 無視 */ }
}

async function loadWave() {
  try {
    S.wave = await api("/api/waveform?p=" + encodeURIComponent(S.P));
    drawWave();
  } catch (e) { /* 無視 */ }
}

function layoutStage() {
  if (!S.proj) return;
  const w = S.proj.media?.w || 1920, h = S.proj.media?.h || 1080;
  const wrap = $("#stageWrap");
  const W = wrap.clientWidth, H = wrap.clientHeight;
  const sc = Math.min(W / w, H / h);
  $("#stage").style.width = Math.floor(w * sc) + "px";
  $("#stage").style.height = Math.floor(h * sc) + "px";
}
window.addEventListener("resize", () => { layoutStage(); renderTimeline(); });

function curTime() { return video.currentTime || 0; }
function seek(t) {
  video.currentTime = clamp(t, 0, S.dur);
  tick(true);
}

$("#btnPlay").addEventListener("click", togglePlay);
$("#btnBack").addEventListener("click", () => seek(curTime() - 5));
$("#btnFwd").addEventListener("click", () => seek(curTime() + 5));
function togglePlay() {
  if (!S.P) return;
  if (video.paused) {
    const c = $("#skipCuts").checked && cutAt(curTime());
    if (c) video.currentTime = c.e;
    video.play();
  } else video.pause();
}
video.addEventListener("play", () => ($("#btnPlay").textContent = "⏸"));
video.addEventListener("pause", () => ($("#btnPlay").textContent = "▶"));

let stopAt = null; // 区間だけ再生するとき
function playRange(a, b, skip = true) {
  $("#skipCuts").checked = skip;
  stopAt = b;
  video.currentTime = a;
  video.play();
}

let lastTick = -1;
function tick(force) {
  if (S.P) {
    const t = curTime();
    if (!video.paused) {
      if (stopAt != null && t >= stopAt) { video.pause(); stopAt = null; }
      else if ($("#skipCuts").checked) {
        const c = cutAt(t);
        if (c) video.currentTime = Math.min(c.e + 0.001, S.dur);
      }
    } else stopAt = stopAt && video.paused ? null : stopAt;
    if (force || t !== lastTick) {
      lastTick = t;
      $("#timeLabel").textContent = `元 ${fmt(t)} ／ 完成 ${fmt(toEdited(t))} / ${fmt(editedDuration())}`;
      $("#playhead").style.left = t * S.pps + "px";
      renderOverlay(t);
      if (!video.paused) followPlayhead(t);
      window.onTimeTick && window.onTimeTick(t);
    }
  }
  requestAnimationFrame(() => tick(false));
}
requestAnimationFrame(() => tick(true));

function followPlayhead(t) {
  const sc = $("#tlScroll");
  const x = t * S.pps;
  if (x < sc.scrollLeft || x > sc.scrollLeft + sc.clientWidth - 40) sc.scrollLeft = x - 80;
}

// ---- 字幕の見た目（Remotion のテンプレートの近似） ----
const CN = { white: "#fff", black: "#111", red: "#e02020", blue: "#2148ff", green: "#1fa34a", purple: "#7a3fc4", yellow: "#ffe600",
  gold: "#ffd34d", pink: "#ff5fa2", orange: "#ff8a00", navy: "#1d2670", gradient: "#ff7a59" };
const SPEAKER_COLORS = ["#e02020", "#2148ff", "#1fa34a", "#b8862f"];

function telopLook(it) {
  const v = it.template || "main";
  let fg = "#fff", stroke = "#000", bg = null, shadow = false;
  let m;
  if ((m = v.match(/^(\w+?)On(\w+?)Box$/))) { fg = CN[m[1].toLowerCase()] || "#fff"; bg = CN[m[2].toLowerCase()] || "#000"; stroke = null; }
  else if (v === "proBoxBlack" || v === "bandFull") { fg = "#fff"; bg = "rgba(0,0,0,.72)"; stroke = null; }
  else if (v === "proBoxWhite" || v === "quoteCard") { fg = "#111"; bg = "rgba(255,255,255,.88)"; stroke = null; }
  else if (v === "markerYellow") { fg = "#111"; bg = "#ffe600"; stroke = null; }
  else if (v === "whiteTextPinkBlueBox") { fg = "#fff"; bg = "#ff5fa2"; stroke = null; }
  else if ((m = v.match(/^(white|black|red|blue|gold|yellow)(\w*?)(Thick|Double)?Stroke(Mincho)?$/))) {
    fg = CN[m[1]]; stroke = CN[(m[2] || "black").toLowerCase()] || "#000";
  } else if ((m = v.match(/^(white|gold|yellow)BlackShadow/))) { fg = CN[m[1]]; stroke = "#000"; shadow = true; }
  else if (v === "emphasisRed") { fg = "#ff3030"; stroke = "#fff"; }
  else if (v === "emphasisOrange") { fg = "#ff8a00"; stroke = "#fff"; }
  else if (v === "negativeBlack" || v === "cruelNavy" || v === "cruelNavyBrush" || v === "darkPurple") { fg = "#fff"; bg = v === "darkPurple" ? "#3b1b5c" : "#1d2670"; stroke = null; }
  else if (v === "questionBlue") { fg = "#fff"; stroke = "#2148ff"; }
  else if (/Gradient/.test(v)) { fg = "#fff"; stroke = "#7a3fc4"; }
  if ((v === "main" || v === "mainV2") && it.speaker != null) stroke = SPEAKER_COLORS[it.speaker % 4];
  const co = it.colorOverride || {};
  if (co.fg) fg = co.fg;
  if (co.bg) bg = co.bg;
  if (co.stroke) stroke = co.stroke;
  return { fg, stroke, bg, shadow, mincho: /Mincho|quoteCard|bandFull/.test(v) || it.fontFamily === "mincho" };
}

function telopHTML(it) {
  const text = it.text || "";
  const styles = (it.inlineStyles || []).filter((s) => Array.isArray(s.range));
  if (!styles.length) return esc(text);
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const st = styles.find((s) => i >= s.range[0] && i < s.range[1]);
    const ch = esc(text[i]);
    if (!st) { out += ch; continue; }
    const css = [];
    if (st.color) css.push(`color:${st.color}`);
    if (st.fontSize) css.push(`font-size:${st.fontSize}em`);
    if (st.background) css.push(`background:linear-gradient(transparent 60%, ${st.background} 60%)`);
    out += `<span style="${css.join(";")}">${ch}</span>`;
  }
  return out;
}

function defaultTelopY() {
  const cfg = S.proj?.config || {};
  if (cfg.shorts && cfg.shorts.captionYRatio) return cfg.shorts.captionYRatio;
  return (S.proj?.media?.h || 1) > (S.proj?.media?.w || 1) ? 0.72 : 0.86;
}

function renderOverlay(t) {
  const ov = $("#overlay");
  if (!S.proj || !$("#showOverlay").checked) { ov.innerHTML = ""; video.style.transform = ""; return; }
  const parts = [];
  const D = S.data;
  const at = (key, it) => t >= itemStart(key, it) && t < itemEnd(key, it);
  // 寄り
  const z = (D.zoom || []).find((it) => at("zoom", it));
  if (z) {
    const s = +z.scale || 1.1, dur = itemEnd("zoom", z) - itemStart("zoom", z);
    const p = clamp((t - z.startSec) / Math.max(0.01, dur), 0, 1);
    let k = 1;
    if (z.mode === "jump") k = s;
    else if (z.mode === "hold") k = 1 + (s - 1) * Math.min(1, (t - z.startSec) / 0.3);
    else if (z.mode === "pulse") k = 1 + (s - 1) * Math.sin(Math.PI * p);
    else k = 1 + (s - 1) * p;
    video.style.transformOrigin = `${(z.originX ?? 0.5) * 100}% ${(z.originY ?? 0.35) * 100}%`;
    video.style.transform = `scale(${k})`;
  } else video.style.transform = "";
  // 画像
  for (const it of (D.image || []).filter((x) => at("image", x))) {
    const src = "/api/pfile?p=" + encodeURIComponent(S.P) + "&path=" + encodeURIComponent((it.file || "").includes("/") ? "public/" + it.file : "public/images/" + it.file);
    const pos = it.position || "fullscreen";
    let css = "left:0;top:0;width:100%;height:100%;object-fit:cover";
    if (pos === "contain") css = "left:8%;top:8%;width:84%;height:84%;background:rgba(240,236,228,.85)";
    else if (pos === "split-left") css = "left:40%;top:0;width:60%;height:100%;background:rgba(240,236,228,.9)";
    else if (pos === "split-right") css = "left:0;top:0;width:60%;height:100%;background:rgba(240,236,228,.9)";
    else if (pos.startsWith("wipe-")) {
      const w = it.widthPct || 28;
      css = `width:${w}%;height:auto;${pos.includes("t") && pos.endsWith("r") || pos === "wipe-tr" ? "right:3%;top:3%" : ""}`;
      if (pos === "wipe-br") css = `width:${w}%;right:3%;bottom:3%`;
      if (pos === "wipe-bl") css = `width:${w}%;left:3%;bottom:3%`;
      if (pos === "wipe-tl") css = `width:${w}%;left:3%;top:3%`;
      if (pos === "wipe-tr") css = `width:${w}%;right:3%;top:3%`;
    } else if (pos.startsWith("diagram")) {
      const w = it.widthPct || 70;
      css = `width:${w}%;left:${(100 - w) / 2}%;top:6%;height:auto`;
    }
    parts.push(`<img class="ov-img" style="${css}" src="${src}">`);
  }
  // 章タイトル
  const sec = (D.section || []).find((x) => at("section", x));
  if (sec) parts.push(`<div class="ov-section">${esc(sec.chapter ? sec.chapter + " / " + sec.title : sec.title)}</div>`);
  // モーション
  for (const m of (D.motion || []).filter((x) => at("motion", x))) {
    const col = m.color && !CN[m.color] ? m.color : CN[m.color] || "#fff";
    if (m.type === "popText" || m.type === "badge") {
      const bg = m.type === "badge" ? `background:${CN[m.color] || "#e02020"};padding:.1em .5em;border-radius:6px;color:#fff;` : `color:${col};`;
      parts.push(`<div class="ov-motion" style="left:${m.positionX}%;top:${m.positionY}%;${bg}transform:translate(-50%,-50%) rotate(${m.rotation || 0}deg);font-size:${5 * (m.size || 1)}cqmin">${esc(m.text)}</div>`);
    } else if (m.type === "listItem") {
      const n = m.atSec ? m.atSec.filter((a) => t >= a).length : Math.min((m.items || []).length, Math.floor((t - m.startSec) * 30 / (m.itemDelayFrames || 14)) + 1);
      parts.push(`<div class="ov-motion" style="left:${m.positionX}%;top:${m.positionY}%;text-align:left;font-size:3.6cqmin">${(m.items || []).slice(0, n).map((x) => "✔ " + esc(x)).join("<br>")}</div>`);
    } else if (m.type === "kineticStack") {
      for (const [i, l] of (m.lines || []).entries()) {
        if (t - m.startSec < (l.delaySec ?? i * 0.55)) continue;
        parts.push(`<div class="ov-motion" style="left:${l.positionX}%;top:${l.positionY}%;color:${l.color || "#111"};text-shadow:none;transform:translate(-50%,-50%) rotate(${m.rotation ?? -3}deg);font-size:${10 * (l.size || 1)}cqw">${esc(l.text)}</div>`);
      }
    } else if (m.type === "frame" || m.type === "scribbleCircle") {
      parts.push(`<div class="ov-frame" style="left:${m.positionX}%;top:${m.positionY}%;width:${m.width}%;height:${m.height || m.width / 2}%;border-color:${col};${m.type === "scribbleCircle" ? "border-radius:50%" : ""}"></div>`);
    } else if (m.type === "highlightPen") {
      parts.push(`<div style="position:absolute;left:${m.positionX - m.width / 2}%;top:${m.positionY}%;width:${m.width}%;height:1.2cqmin;background:${CN[m.color] || "#ffe600"};opacity:.7"></div>`);
    } else if (m.type === "scribbleArrow") {
      parts.push(`<svg style="position:absolute;inset:0;width:100%;height:100%" viewBox="0 0 100 100" preserveAspectRatio="none"><line x1="${m.fromX}" y1="${m.fromY}" x2="${m.toX}" y2="${m.toY}" stroke="${col}" stroke-width="0.8"/></svg>`);
    }
  }
  // 字幕
  const yDef = defaultTelopY();
  for (const it of (D.telop || []).filter((x) => at("telop", x))) {
    const L = telopLook(it);
    if (it.backdropDim) parts.push(`<div class="ov-dim" style="opacity:${it.backdropDim}"></div>`);
    const x = it.position?.x ?? (it.vertical ? 0.88 : 0.5);
    const y = it.position?.y ?? (it.vertical ? 0.42 : yDef);
    const css = [`left:${x * 100}%`, `top:${y * 100}%`, `color:${L.fg}`];
    if (L.bg) css.push(`background:${L.bg}`);
    if (L.stroke) css.push(`-webkit-text-stroke:0.9cqmin ${L.stroke};paint-order:stroke fill`);
    if (L.shadow) css.push("text-shadow:0.4cqmin 0.4cqmin 0 #000");
    if (L.mincho) css.push(`font-family:"Hiragino Mincho ProN",serif`);
    css.push(`transform:translate(-50%,-50%) rotate(${-(it.slant || 0)}deg)`);
    parts.push(`<div class="ov-telop ${it.vertical ? "vertical" : ""}" style="${css.join(";")}">${telopHTML(it)}</div>`);
  }
  // 章カード（本編の前に差し込まれる。ここでは位置の目印として出す）
  const card = (D.chapterCard || []).find((x) => Math.abs(t - x.atSec) < 0.6);
  if (card) parts.push(`<div class="ov-label">ここに章カード「${esc(card.title)}」（${card.durationSec || 2.4}秒）が入ります</div>`);
  const c = cutAt(t);
  if (c && !$("#skipCuts").checked) parts.push(`<div class="ov-label" style="background:#a22">カットされる区間</div>`);
  ov.innerHTML = parts.join("");
}

// ======================================================================
// タイムライン
// ======================================================================
function laneItems(key) {
  if (key === "transcript") return (S.proj?.transcript?.segments || []).map((s) => ({ startSec: s.start, endSec: s.end, text: s.text }));
  if (key === "bgm") {
    const b = S.proj?.bgm || {};
    const plan = S.proj?.bgmPlan;
    if ((b.enabled && b.file) || plan) return [{ startSec: 0, endSec: S.dur, text: b.file ? b.file.split("/").pop() : (plan.sourceName || plan.file) }];
    return [];
  }
  return S.data[key] || [];
}

function clipLabel(key, it) {
  if (key === "telop" || key === "transcript" || key === "bgm") return it.text || "";
  if (key === "se") return (it.file || "").replace(/\.\w+$/, "");
  if (key === "zoom") return `${it.mode || "in"} ×${it.scale || 1.1}`;
  if (key === "motion") return `${it.type}${it.text ? "：" + it.text : ""}`;
  if (key === "image") return it.file || "";
  if (key === "section" || key === "chapterCard") return it.title || "";
  if (key === "cut") return it.type + (it.reason ? "：" + it.reason : "");
  return "";
}

function renderTimeline() {
  if (!S.proj) return;
  const W = Math.max(S.dur * S.pps + 200, $("#tlScroll").clientWidth);
  $("#tlInner").style.width = W + "px";
  $("#tlLabels").innerHTML = `<div class="lab ruler">時間</div><div class="lab wave">音</div>` +
    LANES.map((l) => `<div class="lab" title="${l.ro ? "読み取りのみ" : "ダブルクリックで追加"}">${l.label}</div>`).join("");
  const rows = [];
  // 目盛り
  const step = S.pps >= 120 ? 1 : S.pps >= 40 ? 5 : S.pps >= 15 ? 10 : 30;
  let ticks = "";
  for (let s = 0; s <= S.dur; s += step) ticks += `<div class="tick" style="left:${s * S.pps}px">${fmt(s).replace(/\.0$/, "")}</div>`;
  rows.push(`<div class="track ruler" id="ruler">${ticks}</div>`);
  rows.push(`<div class="track wave"><canvas id="waveCv"></canvas></div>`);
  for (const lane of LANES) {
    const items = laneItems(lane.key);
    let html = "";
    if (lane.key === "cut") {
      const cand = S.proj.cutReview?.candidates || [];
      if (window.cutPanelOpen) for (const c of cand) {
        html += `<div class="clip k-cand readonly" data-cand="${esc(c.id)}" style="left:${c.startSec * S.pps}px;width:${Math.max(3, (c.endSec - c.startSec) * S.pps)}px" title="候補 ${esc(c.id)}：${esc(c.type)} ${esc(c.cutText || "")}"></div>`;
      }
    }
    items.forEach((it, i) => {
      const s = itemStart(lane.key, it), e = itemEnd(lane.key, it);
      if (it._onlyComment || it._raw) return;
      const sel = S.sel && S.sel.key === lane.key && S.sel.idx === i ? " sel" : "";
      const ro = lane.ro ? " readonly" : "";
      html += `<div class="clip k-${lane.key}${sel}${ro}" data-key="${lane.key}" data-idx="${i}" style="left:${s * S.pps}px;width:${Math.max(4, (e - s) * S.pps)}px" title="${esc(fmt(s) + "〜" + fmt(e) + " " + clipLabel(lane.key, it))}">` +
        (lane.ro ? "" : `<div class="h l"></div><div class="h r"></div>`) + esc(clipLabel(lane.key, it)) + `</div>`;
    });
    rows.push(`<div class="track" data-lane="${lane.key}">${html}</div>`);
  }
  $("#tlRows").innerHTML = rows.join("") + S.cuts.map((c) => `<div class="cutshade" style="left:${c.s * S.pps}px;width:${(c.e - c.s) * S.pps}px"></div>`).join("");
  $("#playhead").style.left = curTime() * S.pps + "px";
  drawWave();
}

function drawWave() {
  const cv = $("#waveCv");
  if (!cv || !S.wave) return;
  const W = Math.min(32000, Math.ceil(S.dur * S.pps));
  cv.width = W; cv.height = 34; cv.style.width = W + "px";
  const g = cv.getContext("2d");
  g.fillStyle = "#4f8cff88";
  const per = S.wave.perSec, pk = S.wave.peaks;
  for (let x = 0; x < W; x++) {
    const a = Math.floor((x / S.pps) * per), b = Math.max(a + 1, Math.floor(((x + 1) / S.pps) * per));
    let m = 0;
    for (let i = a; i < b && i < pk.length; i++) m = Math.max(m, pk[i]);
    const h = Math.max(1, m * 32);
    g.fillRect(x, 17 - h / 2, 1, h);
  }
}

$("#zoom").addEventListener("input", (e) => {
  const sc = $("#tlScroll");
  const center = (sc.scrollLeft + sc.clientWidth / 2) / S.pps;
  S.pps = +e.target.value;
  renderTimeline();
  sc.scrollLeft = center * S.pps - sc.clientWidth / 2;
});

// ---- タイムラインのマウス操作 ----
let drag = null;
$("#tlRows").addEventListener("mousedown", (e) => {
  if (!S.proj) return;
  const sc = $("#tlScroll");
  const rect = $("#tlInner").getBoundingClientRect();
  const t = (e.clientX - rect.left) / S.pps;
  if (e.target.closest("#ruler")) {
    seek(t);
    drag = { mode: "seek" };
    return;
  }
  const cand = e.target.closest(".clip[data-cand]");
  if (cand) { window.selectCand && window.selectCand(cand.dataset.cand); return; }
  const clip = e.target.closest(".clip[data-key]");
  if (!clip) { seek(t); return; }
  const key = clip.dataset.key, idx = +clip.dataset.idx;
  const lane = LANES.find((l) => l.key === key);
  select(key, idx);
  if (lane.ro) {
    const it = laneItems(key)[idx];
    if (it) seek(itemStart(key, it) + 0.01);
    return;
  }
  const it = S.data[key][idx];
  const mode = e.target.classList.contains("l") ? "l" : e.target.classList.contains("r") ? "r" : "move";
  drag = { mode, key, idx, x0: e.clientX, s0: itemStart(key, it), e0: itemEnd(key, it), snap: JSON.stringify(S.data[key]), moved: false };
  void sc;
});
window.addEventListener("mousemove", (e) => {
  if (!drag) return;
  const rect = $("#tlInner").getBoundingClientRect();
  if (drag.mode === "seek") { seek((e.clientX - rect.left) / S.pps); return; }
  const dt = (e.clientX - drag.x0) / S.pps;
  if (Math.abs(e.clientX - drag.x0) < 3 && !drag.moved) return;
  drag.moved = true;
  const it = S.data[drag.key][drag.idx];
  if (drag.mode === "move") {
    const len = drag.e0 - drag.s0;
    const ns = clamp(drag.s0 + dt, 0, Math.max(0, S.dur - 0.05));
    setStart(drag.key, it, ns);
    if (drag.key === "telop" || drag.key === "zoom" || drag.key === "motion" || drag.key === "image" || drag.key === "section") it.endSec = r3(ns + len);
    if (drag.key === "motion" && Array.isArray(it.atSec)) it.atSec = it.atSec.map((a) => r3(a + (ns - itemStart(drag.key, it)) ));
  } else if (drag.mode === "l") {
    const ne = drag.e0;
    const ns = clamp(drag.s0 + dt, 0, ne - 0.1);
    if (drag.key === "se" || drag.key === "chapterCard") { setStart(drag.key, it, ns); setEnd(drag.key, it, ne); }
    else setStart(drag.key, it, ns);
  } else {
    setEnd(drag.key, it, Math.max(drag.s0 + 0.1, drag.e0 + dt));
  }
  const el = $(`.clip[data-key="${drag.key}"][data-idx="${drag.idx}"]`);
  if (el) {
    el.style.left = itemStart(drag.key, it) * S.pps + "px";
    el.style.width = Math.max(4, (itemEnd(drag.key, it) - itemStart(drag.key, it)) * S.pps) + "px";
  }
  renderOverlay(curTime());
});
window.addEventListener("mouseup", () => {
  if (!drag) return;
  if (drag.moved) {
    pushUndo(drag.key, drag.snap);
    sortKeepSel(drag.key);
    markDirty(drag.key);
    renderTimeline();
    renderInspector();
  }
  drag = null;
});
$("#tlRows").addEventListener("dblclick", (e) => {
  const track = e.target.closest(".track[data-lane]");
  if (!track || e.target.closest(".clip")) return;
  const key = track.dataset.lane;
  const lane = LANES.find((l) => l.key === key);
  if (lane.ro) {
    if (key === "cut") window.showSideTab && window.showSideTab("cuts");
    if (key === "bgm") { S.sel = { key: "bgm", idx: 0 }; renderInspector(); }
    return;
  }
  const rect = $("#tlInner").getBoundingClientRect();
  addItem(key, (e.clientX - rect.left) / S.pps);
});

function sortKeepSel(key) {
  const arr = S.data[key];
  const selObj = S.sel && S.sel.key === key ? arr[S.sel.idx] : null;
  arr.sort((a, b) => itemStart(key, a) - itemStart(key, b));
  if (selObj) S.sel.idx = arr.indexOf(selObj);
}

// ======================================================================
// 追加・削除・元に戻す・保存
// ======================================================================
function mostCommon(arr, f, dflt) {
  const c = {};
  for (const x of arr) { const v = f(x); if (v) c[v] = (c[v] || 0) + 1; }
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || dflt;
}

function addItem(key, t) {
  t = r3(clamp(t, 0, S.dur));
  const A = S.proj.assets || {};
  const T = S.data.telop || [];
  const tpl = {
    telop: { startSec: t, endSec: r3(t + 2), text: "新しい字幕", template: mostCommon(T, (x) => x.template, "main"), animation: mostCommon(T, (x) => x.animation, "none") },
    se: { startSec: t, file: A.se?.includes("pop_soft.mp3") ? "pop_soft.mp3" : A.se?.[0] || "pop_soft.mp3", volume: 0.5 },
    zoom: { startSec: t, endSec: r3(t + 1.5), scale: 1.1, mode: "in" },
    motion: { type: "popText", startSec: t, endSec: r3(t + 1.5), text: "強調", positionX: 50, positionY: 30 },
    image: { startSec: t, endSec: r3(t + 4), file: A.images?.[0] || "", position: "fullscreen", motion: "fadeIn" },
    section: { startSec: t, endSec: r3(Math.min(S.dur, t + 60)), title: "章タイトル" },
    chapterCard: { atSec: t, title: "章タイトル", durationSec: 2 },
  }[key];
  if (!tpl) return;
  pushUndo(key);
  S.data[key] = S.data[key] || [];
  S.data[key].push(tpl);
  S.sel = { key, idx: S.data[key].length - 1 };
  sortKeepSel(key);
  markDirty(key);
  renderTimeline();
  renderInspector();
  window.renderSide && window.renderSide();
}

function deleteSel() {
  if (!S.sel || LANES.find((l) => l.key === S.sel.key)?.ro) return;
  const { key, idx } = S.sel;
  pushUndo(key);
  S.data[key].splice(idx, 1);
  S.sel = null;
  markDirty(key);
  renderTimeline();
  renderInspector();
  window.renderSide && window.renderSide();
}

function duplicateSel() {
  if (!S.sel || LANES.find((l) => l.key === S.sel.key)?.ro) return;
  const { key, idx } = S.sel;
  pushUndo(key);
  const it = JSON.parse(JSON.stringify(S.data[key][idx]));
  delete it._comment;
  const len = itemEnd(key, it) - itemStart(key, it);
  const s = itemStart(key, it) + len;
  setStart(key, it, s);
  if ("endSec" in it) it.endSec = r3(s + len);
  S.data[key].push(it);
  S.sel = { key, idx: S.data[key].length - 1 };
  sortKeepSel(key);
  markDirty(key);
  renderTimeline();
  renderInspector();
}

function pushUndo(key, snap) {
  S.undo.push({ key, items: snap || JSON.stringify(S.data[key] || []) });
  if (S.undo.length > 200) S.undo.shift();
  S.redo = [];
}
function undoRedo(from, to) {
  const u = from.pop();
  if (!u) return;
  to.push({ key: u.key, items: JSON.stringify(S.data[u.key] || []) });
  S.data[u.key] = JSON.parse(u.items);
  S.sel = null;
  markDirty(u.key);
  renderTimeline();
  renderInspector();
  window.renderSide && window.renderSide();
}
$("#btnUndo").addEventListener("click", () => undoRedo(S.undo, S.redo));
$("#btnRedo").addEventListener("click", () => undoRedo(S.redo, S.undo));

let saveTimer = null;
function markDirty(key) {
  S.dirty.add(key);
  $("#saveState").textContent = "● 未保存";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 900);
}
async function flushSave() {
  clearTimeout(saveTimer);
  if (!S.P || !S.dirty.size) return;
  const keys = [...S.dirty];
  S.dirty.clear();
  $("#saveState").textContent = "保存中…";
  try {
    for (const key of keys) await api("/api/data", { p: S.P, key, items: S.data[key] || [] });
    $("#saveState").textContent = "✓ 保存しました";
  } catch (e) {
    keys.forEach((k) => S.dirty.add(k));
    $("#saveState").textContent = "⚠ 保存に失敗";
    toast("保存に失敗しました：" + e.message, 5000);
  }
}
window.addEventListener("beforeunload", (e) => { if (S.dirty.size) { flushSave(); e.preventDefault(); } });

function select(key, idx) {
  S.sel = { key, idx };
  $$(".clip.sel").forEach((c) => c.classList.remove("sel"));
  const el = $(`.clip[data-key="${key}"][data-idx="${idx}"]`);
  if (el) el.classList.add("sel");
  renderInspector();
  window.onSelect && window.onSelect(key, idx);
}

// ---- キーボード ----
window.addEventListener("keydown", (e) => {
  const tag = (e.target.tagName || "").toLowerCase();
  const typing = tag === "input" || tag === "textarea" || tag === "select";
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); flushSave(); return; }
  if (typing || !S.P || !$("#modal").classList.contains("hidden")) return;
  if (e.key === " ") { e.preventDefault(); togglePlay(); }
  else if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? undoRedo(S.redo, S.undo) : undoRedo(S.undo, S.redo); }
  else if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicateSel(); }
  else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSel(); }
  else if (e.key === "ArrowLeft") seek(curTime() - (e.shiftKey ? 1 : 1 / 30));
  else if (e.key === "ArrowRight") seek(curTime() + (e.shiftKey ? 1 : 1 / 30));
});

// ======================================================================
// プロパティ（右側）
// ======================================================================
const TEMPLATES = ["main", "mainV2", "emphasisRed", "emphasisOrange", "negativeBlack", "cruelNavy", "darkPurple", "questionBlue", "markerYellow",
  "whiteBlackShadow", "whiteBlackShadowGothic", "whiteBlackShadowMincho", "goldBlackShadow", "yellowBlackShadow", "whiteRedStroke", "whitePurpleStroke",
  "whiteGreenStroke", "whiteBlueStroke", "whiteRedThickStroke", "blackWhiteStroke", "redWhiteStroke", "blueGoldStroke", "whiteRedDoubleStroke",
  "whiteBlueDoubleStroke", "whiteBlackDoubleStroke", "whiteOnBlackBox", "blackOnWhiteBox", "blackOnYellowBox", "purpleOnWhiteBox", "greenOnWhiteBox",
  "redOnWhiteBox", "blueOnWhiteBox", "whiteTextPinkBlueBox", "goldOnNavyBox", "gradientOnWhiteBox", "greenGoldGradient", "blackPurpleGradient",
  "orangeGradient", "cruelNavyBrush", "proBoxBlack", "proBoxWhite", "quoteCard", "bandFull", "kineticOutline", "whiteBlackStrokeMincho"];
const ANIMS = ["none", "slideIn", "fadeOnly", "slideFromLeft", "fadeBlurFromBottom", "slideLeftFadeBlur", "fadeFromRight", "fadeFromLeft", "charByChar", "lineSlide"];
const FONTS = ["", "default", "maru", "mincho", "delaGothic", "reggae", "rampart", "rocknroll", "mochiyPop", "hachiMaru", "kaiseiDecol", "yuseiMagic", "fude", "shippori", "dot", "train", "stick", "tanuki", "azuki", "chikara"];
const IMG_POS = ["fullscreen", "contain", "split-left", "split-right", "wipe-tr", "wipe-br", "wipe-bl", "wipe-tl", "diagram", "diagram-center", "diagram-right", "diagram-left"];
const IMG_MOTION = ["fadeIn", "kenBurns", "popIn", "slideFromRight", "slideFromLeft", "wipeIn", "loop"];
const MOTION_TYPES = ["popText", "badge", "listItem", "frame", "highlightPen", "scribbleCircle", "scribbleArrow", "kineticStack"];

// [キー, 表示名, 種類, 選択肢]
const SCHEMA = {
  telop: [["startSec", "開始(秒)", "num"], ["endSec", "終了(秒)", "num"], ["text", "本文", "textarea"], ["template", "見た目", "sel", TEMPLATES],
    ["animation", "出かた", "sel", ANIMS], ["fontFamily", "書体", "sel", FONTS], ["speaker", "話者番号", "num"], ["vertical", "縦書き", "chk"],
    ["position.x", "位置 X(0〜1)", "num"], ["position.y", "位置 Y(0〜1)", "num"], ["slant", "斜め(度)", "num"], ["backdropDim", "暗転(0〜0.8)", "num"],
    ["colorOverride.fg", "文字色", "color"], ["colorOverride.stroke", "縁の色", "color"], ["colorOverride.bg", "帯・箱の色", "color"], ["inlineStyles", "部分装飾(JSON)", "json"]],
  se: [["startSec", "開始(秒)", "num"], ["durationSec", "長さ(秒)", "num"], ["file", "効果音", "se"], ["volume", "音量(0〜1)", "num"]],
  zoom: [["startSec", "開始(秒)", "num"], ["endSec", "終了(秒)", "num"], ["scale", "倍率", "num"], ["mode", "動き", "sel", ["in", "hold", "pulse", "jump"]],
    ["originX", "中心 X(0〜1)", "num"], ["originY", "中心 Y(0〜1)", "num"]],
  image: [["startSec", "開始(秒)", "num"], ["endSec", "終了(秒)", "num"], ["file", "画像", "image"], ["position", "配置", "sel", IMG_POS],
    ["motion", "動き", "sel", IMG_MOTION], ["widthPct", "幅(%)", "num"], ["focusX", "寄り先 X", "num"], ["focusY", "寄り先 Y", "num"], ["personFocusX", "人物の中心 X", "num"]],
  section: [["startSec", "開始(秒)", "num"], ["endSec", "終了(秒)", "num"], ["title", "節タイトル", "text"], ["chapter", "章名", "text"], ["prefix", "補助テキスト", "text"]],
  chapterCard: [["atSec", "差し込む位置(秒)", "num"], ["title", "見出し", "text"], ["durationSec", "長さ(秒)", "num"], ["color", "文字色", "color"], ["sfx", "効果音", "se"], ["background", "背景(public/相対)", "text"]],
  motion: {
    _common: [["type", "種類", "sel", MOTION_TYPES], ["startSec", "開始(秒)", "num"], ["endSec", "終了(秒)", "num"]],
    popText: [["text", "文字", "text"], ["positionX", "位置 X(%)", "num"], ["positionY", "位置 Y(%)", "num"], ["color", "色", "color"], ["size", "大きさ", "num"], ["rotation", "回転(度)", "num"], ["subtype", "出かた", "sel", ["", "default", "wordByWord", "charByChar"]]],
    badge: [["text", "文字", "text"], ["positionX", "位置 X(%)", "num"], ["positionY", "位置 Y(%)", "num"], ["color", "色", "sel", ["red", "blue", "green", "yellow", "purple", "orange", "pink", "gold", "navy", "white"]], ["size", "大きさ", "num"], ["rotation", "回転(度)", "num"]],
    listItem: [["items", "項目(JSON配列)", "json"], ["positionX", "位置 X(%)", "num"], ["positionY", "位置 Y(%)", "num"], ["atSec", "各項目の秒(JSON)", "json"], ["itemDelayFrames", "間隔(フレーム)", "num"]],
    frame: [["positionX", "中心 X(%)", "num"], ["positionY", "中心 Y(%)", "num"], ["width", "幅(%)", "num"], ["height", "高さ(%)", "num"], ["color", "色", "color"], ["thickness", "太さ", "num"]],
    highlightPen: [["positionX", "中心 X(%)", "num"], ["positionY", "位置 Y(%)", "num"], ["width", "幅(%)", "num"], ["color", "色", "sel", ["yellow", "pink", "blue", "green", "orange"]], ["thickness", "太さ", "num"]],
    scribbleCircle: [["positionX", "中心 X(%)", "num"], ["positionY", "中心 Y(%)", "num"], ["width", "幅(%)", "num"], ["height", "高さ(%)", "num"], ["color", "色", "color"]],
    scribbleArrow: [["fromX", "始点 X(%)", "num"], ["fromY", "始点 Y(%)", "num"], ["toX", "終点 X(%)", "num"], ["toY", "終点 Y(%)", "num"], ["curve", "カーブ", "num"], ["color", "色", "color"]],
    kineticStack: [["lines", "行(JSON)", "json"], ["rotation", "傾き(度)", "num"]],
  },
};

function getPath(o, p) { return p.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o); }
function setPath(o, p, v) {
  const ks = p.split(".");
  let cur = o;
  for (const k of ks.slice(0, -1)) { if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {}; cur = cur[k]; }
  const last = ks[ks.length - 1];
  if (v === undefined || v === "" || v === null) delete cur[last]; else cur[last] = v;
  if (ks.length > 1 && Object.keys(cur).length === 0) delete o[ks[0]];
}

function fieldsFor(key, it) {
  if (key === "motion") return [...SCHEMA.motion._common, ...(SCHEMA.motion[it.type] || [])];
  return SCHEMA[key] || [];
}

function renderInspector() {
  const box = $("#inspBody");
  if (!S.proj) { box.innerHTML = ""; return; }
  if (!S.sel) {
    box.innerHTML = projectInfoHTML();
    bindProjectInfo();
    return;
  }
  const { key, idx } = S.sel;
  if (key === "bgm") { box.innerHTML = bgmHTML(); bindBgm(); return; }
  const it = laneItems(key)[idx];
  if (!it) { S.sel = null; return renderInspector(); }
  const ro = LANES.find((l) => l.key === key)?.ro;
  if (ro) {
    box.innerHTML = `<h3>${KEY_LABEL[key]}</h3><div class="muted small">ここは読み取りのみです。</div>
      <p>${fmt(itemStart(key, it))} 〜 ${fmt(itemEnd(key, it))}</p><p>${esc(clipLabel(key, it))}</p>
      ${key === "cut" ? `<p class="small muted">カットの変更は左の「カット承認」で、候補を選び直して承認します（TotonouMovie の承認記録の仕組みを保つため、直接は書き換えません）。</p><button id="goCuts">カット承認を開く</button>` : ""}
      ${key === "transcript" ? `<button id="mkTelop">この発話から字幕を作る</button>` : ""}`;
    $("#goCuts")?.addEventListener("click", () => window.showSideTab("cuts"));
    $("#mkTelop")?.addEventListener("click", () => {
      addItem("telop", it.startSec);
      const t = S.data.telop[S.sel.idx];
      t.endSec = r3(it.endSec); t.text = it.text;
      markDirty("telop"); renderTimeline(); renderInspector();
    });
    return;
  }
  const rows = fieldsFor(key, it).map(([k, label, type, opts]) => fieldHTML(k, label, type, opts, getPath(it, k))).join("");
  const known = new Set(fieldsFor(key, it).map((f) => f[0].split(".")[0]));
  const extra = Object.keys(it).filter((k) => !known.has(k) && !k.startsWith("_"));
  box.innerHTML = `<h3>${KEY_LABEL[key]} <span class="muted small">#${idx + 1}</span></h3>
    <div class="btnrow"><button id="iSeek">▶ ここを再生</button><button id="iDup">複製</button><button id="iDel" class="danger">削除</button></div>
    ${rows}
    ${extra.length ? `<h4>その他の項目</h4>` + extra.map((k) => fieldHTML(k, k, typeof it[k] === "number" ? "num" : typeof it[k] === "boolean" ? "chk" : typeof it[k] === "object" ? "json" : "text", null, it[k])).join("") : ""}
    ${it._comment ? `<div class="muted small">印: ${esc(it._comment)}</div>` : ""}
    <p class="muted small">時刻はすべて元動画の秒です（完成動画では ${fmt(toEdited(itemStart(key, it)))} あたり）。</p>`;
  $("#iSeek").onclick = () => playRange(Math.max(0, itemStart(key, it) - 0.5), itemEnd(key, it) + 0.5);
  $("#iDup").onclick = duplicateSel;
  $("#iDel").onclick = deleteSel;
  bindFields(box, key, it);
}

function fieldHTML(k, label, type, opts, val) {
  const id = "f_" + k.replace(/\./g, "_");
  let input = "";
  if (type === "num") input = `<input type="number" step="any" class="grow" id="${id}" data-k="${k}" data-t="num" value="${val ?? ""}">`;
  else if (type === "text") input = `<input type="text" class="grow" id="${id}" data-k="${k}" data-t="text" value="${esc(val ?? "")}">`;
  else if (type === "textarea") input = `<textarea class="grow" rows="2" id="${id}" data-k="${k}" data-t="text">${esc(val ?? "")}</textarea>`;
  else if (type === "chk") input = `<input type="checkbox" id="${id}" data-k="${k}" data-t="chk" ${val ? "checked" : ""}>`;
  else if (type === "color") input = `<input type="color" id="${id}c" data-k="${k}" data-t="colorpick" value="${/^#[0-9a-f]{6}$/i.test(val || "") ? val : "#ffffff"}"><input type="text" class="grow" id="${id}" data-k="${k}" data-t="text" value="${esc(val ?? "")}" placeholder="未指定">`;
  else if (type === "json") input = `<textarea class="grow" rows="3" id="${id}" data-k="${k}" data-t="json" style="font-family:monospace;font-size:11px">${esc(val === undefined ? "" : JSON.stringify(val))}</textarea>`;
  else if (type === "sel" || type === "se" || type === "image") {
    let list = opts || [];
    if (type === "se") list = ["", ...(S.proj.assets?.se || [])];
    if (type === "image") list = ["", ...(S.proj.assets?.images || [])];
    if (val && !list.includes(val)) list = [val, ...list];
    input = `<select class="grow" id="${id}" data-k="${k}" data-t="text">${list.map((o) => `<option value="${esc(o)}" ${o === (val ?? "") ? "selected" : ""}>${esc(o || "（なし）")}</option>`).join("")}</select>`;
    if (type === "se") input += `<button class="small" data-play-se="${id}" title="試聴">🔊</button>`;
    if (type === "image") input += `<button class="small" data-add-img="${id}" title="画像を追加">＋</button>`;
  }
  return `<div class="row"><label for="${id}">${esc(label)}</label>${input}</div>`;
}

function bindFields(box, key, it) {
  let snap = null;
  box.querySelectorAll("[data-k]").forEach((el) => {
    el.addEventListener("focus", () => { snap = JSON.stringify(S.data[key]); });
    const apply = () => {
      const k = el.dataset.k, t = el.dataset.t;
      if (!snap) snap = JSON.stringify(S.data[key]);
      let v;
      if (t === "num") v = el.value === "" ? undefined : r3(+el.value);
      else if (t === "chk") v = el.checked ? true : undefined;
      else if (t === "json") {
        if (el.value.trim() === "") v = undefined;
        else { try { v = JSON.parse(el.value); el.style.borderColor = ""; } catch (e) { el.style.borderColor = "var(--danger)"; return; } }
      } else if (t === "colorpick") { v = el.value; const tx = box.querySelector(`[data-k="${k}"][data-t="text"]`); if (tx) tx.value = v; }
      else v = el.value;
      setPath(it, k, v);
      pushUndo(key, snap);
      snap = JSON.stringify(S.data[key]);
      markDirty(key);
      if (k === "type") { renderInspector(); }
      if (k === "startSec" || k === "atSec") sortKeepSel(key);
      renderTimeline();
      renderOverlay(curTime());
      window.renderSide && window.renderSide(true);
    };
    el.addEventListener(el.tagName === "SELECT" || el.type === "checkbox" || el.type === "color" ? "change" : "input", debounce(apply, el.tagName === "TEXTAREA" || el.type === "text" ? 350 : 0));
  });
  box.querySelectorAll("[data-play-se]").forEach((b) => b.addEventListener("click", () => {
    const name = $("#" + b.dataset.playSe).value;
    if (name) new Audio("/api/sefile?p=" + encodeURIComponent(S.P) + "&name=" + encodeURIComponent(name)).play();
  }));
  box.querySelectorAll("[data-add-img]").forEach((b) => b.addEventListener("click", async () => {
    const r = await api("/api/choose", { kind: "file", prompt: "差し込む画像を選んでください" });
    if (!r.path) return;
    const j = await api("/api/add_image", { p: S.P, path: r.path });
    S.proj.assets.images = [...new Set([...(S.proj.assets.images || []), j.file])].sort();
    pushUndo(key);
    it.file = j.file;
    markDirty(key);
    renderInspector(); renderTimeline();
  }));
}

function debounce(fn, ms) {
  if (!ms) return fn;
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---- 何も選んでいない時：プロジェクトの情報 ----
function projectInfoHTML() {
  const p = S.proj, cfg = p.config || {}, m = p.media || {};
  const n = (k) => (S.data[k] || []).filter((x) => !x._onlyComment).length;
  const removed = S.cuts.reduce((a, c) => a + c.e - c.s, 0);
  return `<h3>${esc(p.title)}</h3>
    <div class="small muted" style="word-break:break-all">${esc(p.path)}</div>
    <h4>動画</h4>
    <div class="small">${m.w}×${m.h}・${cfg.format || ""}・${fmt(S.dur)} → 完成 約${fmt(S.dur - removed)}（カット ${S.cuts.length}件・${removed.toFixed(1)}秒）</div>
    <div class="small muted" style="word-break:break-all">元動画: ${esc(p.inputVideo || "見つかりません")}</div>
    <h4>中身</h4>
    <div class="small">字幕 ${n("telop")}・効果音 ${n("se")}・寄り ${n("zoom")}・モーション ${n("motion")}・画像 ${n("image")}・章 ${n("section")}・章カード ${n("chapterCard")}</div>
    ${p.hookApplied ? `<div class="notice small">冒頭フックを適用済みです。カットの変更（承認のやり直し）はできません。</div>` : ""}
    <h4>タイトル（完成ファイル名）</h4>
    <div class="row"><input type="text" id="cfgTitle" class="grow" value="${esc(cfg.title || "")}"><button id="cfgTitleSave">保存</button></div>
    ${cfg.shorts ? `<h4>字幕の高さ（ショート）</h4><div class="row"><input type="number" step="0.01" id="cfgCapY" value="${cfg.shorts.captionYRatio ?? ""}"><button id="cfgCapYSave">保存</button><span class="small muted">0〜1（上から）</span></div>` : ""}
    <h4>操作</h4>
    <div class="btnrow"><button id="iContrast">字幕の読みやすさを自動補正</button><button id="iJump">寄りの交互切替を作り直す</button></div>
    <p class="small muted">タイムラインの項目を選ぶと、ここで細かく直せます。段の空いている所をダブルクリックすると追加できます。</p>`;
}
function bindProjectInfo() {
  $("#cfgTitleSave")?.addEventListener("click", async () => {
    await api("/api/config", { p: S.P, set: { title: $("#cfgTitle").value.trim() } });
    toast("タイトルを保存しました"); openProject(S.P);
  });
  $("#cfgCapYSave")?.addEventListener("click", async () => {
    await api("/api/config", { p: S.P, set: { "shorts.captionYRatio": +$("#cfgCapY").value } });
    toast("字幕の高さを保存しました"); openProject(S.P);
  });
  $("#iContrast")?.addEventListener("click", () => window.runAction("contrast"));
  $("#iJump")?.addEventListener("click", () => window.runAction("jumpcut_zoom"));
}

// ---- BGM ----
function bgmHTML() {
  const b = S.proj.bgm || {}, plan = S.proj.bgmPlan;
  return `<h3>BGM</h3>
    <p class="small muted">書き出しの最後に、仕上げた声に曲を重ねます（TotonouMovie の bgm と同じ方法。声より小さく、話している間はさらに下がり、章カードの間は止まります）。</p>
    ${plan ? `<div class="notice small">いまの計画: ${esc(plan.sourceName || plan.file)}（${esc(plan.level)}）</div>` : ""}
    <div class="row"><label>使う</label><input type="checkbox" id="bEnabled" ${b.enabled ? "checked" : ""}></div>
    <div class="row"><label>曲</label><input type="text" id="bFile" class="grow" value="${esc(b.file || "")}" placeholder="曲のファイルの場所"><button id="bChoose" class="small">選ぶ</button></div>
    <div class="row"><label>音量</label><select id="bLevel"><option value="quiet" ${b.level !== "standard" ? "selected" : ""}>控えめ（話している間はほぼ聞こえない）</option><option value="standard" ${b.level === "standard" ? "selected" : ""}>標準（話している間も小さく聞こえる）</option></select></div>
    <div class="row"><label>曲の開始位置</label><input type="number" step="0.1" id="bOffset" value="${b.startOffset || 0}"> 秒</div>
    <div class="row"><label>権利</label><label class="chk"><input type="checkbox" id="bRights" ${b.rightsConfirmed ? "checked" : ""}> この曲を動画に使ってよい権利を確認済み</label></div>
    <div class="btnrow"><button id="bSave" class="primary">保存</button></div>
    <p class="small muted">権利の確認が無いと、BGM は重ねません。</p>`;
}
function bindBgm() {
  $("#bChoose").onclick = async () => { const r = await api("/api/choose", { kind: "file", prompt: "BGM の曲を選んでください" }); if (r.path) $("#bFile").value = r.path; };
  $("#bSave").onclick = async () => {
    const d = { p: S.P, enabled: $("#bEnabled").checked, file: $("#bFile").value.trim(), level: $("#bLevel").value, startOffset: +$("#bOffset").value || 0, rightsConfirmed: $("#bRights").checked };
    if (d.enabled && !d.rightsConfirmed) { toast("権利の確認にチェックが無いので、BGM は重ねません"); }
    await api("/api/bgm", d);
    S.proj.bgm = d;
    toast("BGM の設定を保存しました（書き出しの時に重ねます）");
    renderTimeline();
  };
}

// ======================================================================
// 起動
// ======================================================================
async function boot() {
  try {
    S.status = await api("/api/status");
    const j = await api("/api/projects");
    S.projects = j.projects;
  } catch (e) { toast("読み込みに失敗：" + e.message, 6000); }
  fillProjSelect();
  const p = new URLSearchParams(location.search).get("p");
  if (p && S.projects.some((x) => x.name === p)) openProject(p);
  else showHome();
}
window.addEventListener("load", boot);
