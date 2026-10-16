/* totonoumovie の周りの画面（ホーム・左の一覧・カット承認・AI・プロンプト・裏の作業） */
"use strict";

// ======================================================================
// ホーム（プロジェクト一覧）
// ======================================================================
window.renderHome = async function () {
  try {
    S.status = await api("/api/status");
    S.projects = (await api("/api/projects")).projects;
  } catch (e) { toast(e.message, 5000); }
  fillProjSelect();
  const st = S.status || {};
  const notes = [];
  if (st.pluginError) {
    notes.push(`<div class="notice bad"><b>TotonouMovie プラグインが見つかりません。</b><br>${esc(st.pluginError)}<br>
      Claude Code で <code>/plugin marketplace add ~/TotonouMovie</code> → <code>/plugin install totonou-movie@totonou</code> を実行し、
      続けて「TotonouMovie のセットアップをして」と話しかけてください（QUICKSTART-mac.md）。</div>`);
  } else if (st.plugin) {
    notes.push(`<div class="notice good">TotonouMovie ${esc(st.plugin.version || "")} を使います <span class="muted small">${esc(st.plugin.root)}</span></div>`);
  }
  if (!st.claude) notes.push(`<div class="notice bad">claude コマンドが見つかりません。「AIで作る」には Claude Code が必要です。</div>`);
  if (st.cloudSync) notes.push(`<div class="notice bad">作業フォルダが Dropbox・iCloud などの同期フォルダの中です。書き出し中に同期とぶつかって止まることがあります。同期フォルダの外（例：~/Movies/totonou）で <code>totonoumovie</code> を起動してください。</div>`);
  if (st.plugin && !st.settingsFileExists) notes.push(`<div class="notice">TotonouMovie の初期設定がまだのようです。Claude Code で「TotonouMovie のセットアップをして」と話しかけてください（または「AIで作る」の最初に AI が案内します）。</div>`);
  $("#statusBox").innerHTML = notes.join("");
  $("#wsPath").textContent = "作業フォルダ: " + (st.workspace || "");
  $("#projGrid").innerHTML = S.projects.length ? S.projects.map((p) => `
    <div class="pcard" data-p="${esc(p.name)}">
      <h3>${esc(p.title)}</h3>
      <div class="meta">${{ shorts: "ショート", long: "ロング", voiceover: "アフレコ" }[p.mode] || ""}・${esc(p.format || "")}<br>
      更新 ${new Date(p.mtime * 1000).toLocaleString("ja-JP")}<br>
      ${p.outputs.length ? "完成: " + esc(p.outputs.filter((o) => !/_raw|_voice/.test(o)).join("、") || p.outputs[0]) : "まだ書き出していません"}
      ${p.running.length ? `<br><span class="warn">🤖 AI が作業中</span>` : ""}</div>
    </div>`).join("") : `<div class="muted">まだプロジェクトがありません。「動画を渡して AI で作る」から始めてください。</div>`;
  $$("#projGrid .pcard").forEach((c) => c.addEventListener("click", () => openProject(c.dataset.p)));
};
$("#btnReloadProjects").addEventListener("click", () => window.renderHome());
$("#btnCreate").addEventListener("click", () => openCreate());
$("#btnCreate2").addEventListener("click", () => openCreate());

// ======================================================================
// 左の一覧（タブ）
// ======================================================================
let sideTab = "telops";
window.showSideTab = function (t) {
  sideTab = t;
  $$("#sideTabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
  window.cutPanelOpen = t === "cuts";
  renderTimeline();
  window.renderSide();
};
$$("#sideTabs button").forEach((b) => b.addEventListener("click", () => window.showSideTab(b.dataset.t)));

window.renderSide = function (soft) {
  if (!S.proj) return;
  if (sideTab === "telops") { if (!soft || !$("#telopList")) renderTelopList(); }
  else if (sideTab === "cuts") { if (!soft) renderCutPanel(); }
  else if (sideTab === "ai") { if (!soft) renderAIPanel(); }
  else if (sideTab === "files") { if (!soft) renderFilesPanel(); }
};

// ---- 字幕の一覧（本文をその場で直せる） ----
function renderTelopList() {
  const T = S.data.telop || [];
  const box = $("#sideBody");
  box.innerHTML = `<div class="side-head"><b>字幕 ${T.filter((x) => !x._onlyComment).length}件</b><span class="grow"></span>
      <button class="small" id="tlAdd">＋ 今の位置に追加</button></div>
    <div id="telopList">${T.map((it, i) => it._onlyComment || it._raw ? "" : `
      <div class="list-item" data-i="${i}"><div class="t">${fmt(it.startSec)} 〜 ${fmt(it.endSec)} <span class="muted">${esc(it.template || "")}</span></div>
      <textarea rows="${Math.min(4, (it.text || "").split("\n").length)}" data-i="${i}">${esc(it.text)}</textarea></div>`).join("")}</div>`;
  $("#tlAdd").onclick = () => addItem("telop", curTime());
  box.querySelectorAll(".list-item").forEach((el) => el.addEventListener("click", (e) => {
    const i = +el.dataset.i;
    if (e.target.tagName !== "TEXTAREA") seek(S.data.telop[i].startSec + 0.01);
    select("telop", i);
    $$("#telopList .list-item").forEach((x) => x.classList.toggle("on", x === el));
  }));
  box.querySelectorAll("textarea").forEach((ta) => {
    let snap = null;
    ta.addEventListener("focus", () => { snap = JSON.stringify(S.data.telop); seek(S.data.telop[+ta.dataset.i].startSec + 0.01); });
    ta.addEventListener("input", debounce(() => {
      const it = S.data.telop[+ta.dataset.i];
      if (!it) return;
      if (snap) { pushUndo("telop", snap); snap = null; }
      it.text = ta.value;
      markDirty("telop");
      renderOverlay(curTime());
      const clip = $(`.clip[data-key="telop"][data-idx="${ta.dataset.i}"]`);
      if (clip) clip.lastChild.textContent = ta.value;
      if (S.sel && S.sel.key === "telop" && S.sel.idx === +ta.dataset.i) { const f = $("#f_text"); if (f && f !== document.activeElement) f.value = ta.value; }
    }, 300));
  });
}
let lastNow = -1;
window.onTimeTick = function (t) {
  if (sideTab !== "telops") return;
  const T = S.data.telop || [];
  const i = T.findIndex((x) => t >= x.startSec && t < x.endSec);
  if (i === lastNow) return;
  lastNow = i;
  $$("#telopList .list-item").forEach((el) => el.classList.toggle("now", +el.dataset.i === i));
  if (i >= 0 && !video.paused) {
    const el = $(`#telopList .list-item[data-i="${i}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }
};
window.onSelect = function (key, idx) {
  if (key === "telop" && sideTab === "telops") {
    $$("#telopList .list-item").forEach((el) => el.classList.toggle("on", +el.dataset.i === idx));
    $(`#telopList .list-item[data-i="${idx}"]`)?.scrollIntoView({ block: "nearest" });
  }
};

// ======================================================================
// カット承認
// ======================================================================
let cutSel = null;        // 選択中の承認案 Set
let cutRunId = null;      // AI の確認から来たときの作業ID
function appliedIds() {
  const cand = S.proj.cutReview?.candidates || [];
  const ids = new Set();
  for (const c of cand) if (S.cuts.some((r) => r.s - 0.02 <= c.startSec && c.endSec <= r.e + 0.02)) ids.add(c.id);
  return ids;
}
function renderCutPanel() {
  const box = $("#sideBody");
  const rv = S.proj.cutReview;
  const cand = rv?.candidates || [];
  if (!cutSel) {
    const ap = S.proj.cutApprovals?.candidateIds;
    cutSel = new Set(ap && ap.length ? ap : appliedIds());
  }
  const removed = cand.filter((c) => cutSel.has(c.id)).reduce((a, c) => a + (c.endSec - c.startSec), 0);
  const TYPE = { silence: "無音", filler: "フィラー", false_start: "言い直し", redundant: "重複", mistake: "言い間違い", digression: "脱線", cue: "合図" };
  const types = [...new Set(cand.map((c) => c.type))];
  box.innerHTML = `
    ${cutRunId ? `<div class="notice small">🤖 AI がカットの承認を待っています。選んで「承認して反映」を押すと、結果を AI に返して続きを進めます。</div>` : ""}
    ${S.proj.hookApplied ? `<div class="notice bad small">冒頭フックを適用済みのため、カットは変更できません。</div>` : ""}
    <div class="side-head">
      <b>カット候補 ${cand.length}件</b><span class="muted small">${rv ? (rv.status === "reviewed" ? "" : "（暫定表）") : ""}</span><span class="grow"></span>
      <button class="small" id="cRev" title="AI 提案・無音・フィラーから候補表を作り直す（gen_cut_plan review）">候補を作り直す</button>
      <button class="small" id="cClips" title="候補ごとの前後確認クリップを作る">確認クリップ</button>
    </div>
    ${!rv ? `<p class="muted small">候補表（work/edit_instructions.json）がありません。カット候補づくり（文字起こし→無音・フィラー検出→AI 提案）は AI に任せてください（「AI」タブ → 依頼）。</p>` : ""}
    ${cand.length ? `<div class="btnrow">
      <button class="small" id="cAll">全部</button><button class="small" id="cNone">なし</button>
      ${types.map((t) => `<button class="small" data-ty="${t}">${TYPE[t] || t}だけ＋</button>`).join("")}
    </div>
    <div class="small">選択 ${cutSel.size}件・約${removed.toFixed(1)}秒を削る</div>
    <div class="row" style="margin-top:6px"><label>承認する人</label><input type="text" id="cReviewer" class="grow" value="${esc(S.proj.reviewerName || "")}" placeholder="あなたの名前"></div>
    <div class="btnrow"><button class="primary" id="cApply" ${S.proj.hookApplied ? "disabled" : ""}>✔ 承認して反映</button>
      ${cutRunId ? `<input type="text" id="cNote" placeholder="AI への補足（任意）" class="grow">` : ""}</div>` : ""}
    <div id="candList">${cand.map((c) => `
      <div class="cand ${cutSel.has(c.id) ? "on" : ""}" data-id="${esc(c.id)}">
        <input type="checkbox" ${cutSel.has(c.id) ? "checked" : ""} data-id="${esc(c.id)}">
        <div><div class="small"><span class="ty">${TYPE[c.type] || c.type}</span><b>${esc(c.id)}</b> ${fmt(c.startSec)}〜${fmt(c.endSec)}（${(c.endSec - c.startSec).toFixed(2)}秒）
          ${c.confidence != null ? `<span class="muted">確信度 ${(+c.confidence).toFixed(2)}</span>` : ""} ${c.risk && c.risk !== "low" ? `<span class="warn">リスク ${esc(c.risk)}</span>` : ""}</div>
          ${c.cutText ? `<div class="small cut-text">${esc(c.cutText)}</div>` : ""}
          ${c.keepText ? `<div class="small keep-text">残す: ${esc(c.keepText)}</div>` : ""}
          ${c.reason ? `<div class="small muted">${esc(c.reason)}</div>` : ""}
          <div class="btnrow" style="margin:4px 0 0"><button class="small" data-play="before">▶ 元</button><button class="small" data-play="after">▶ カット後</button></div>
        </div></div>`).join("")}</div>`;
  $("#cRev").onclick = () => runAction("cut_review", {}, () => { cutSel = null; });
  $("#cClips").onclick = () => runAction("cut_clips");
  if (!cand.length) return;
  const sync = () => renderCutPanel();
  $("#cAll").onclick = () => { cutSel = new Set(cand.map((c) => c.id)); sync(); };
  $("#cNone").onclick = () => { cutSel = new Set(); sync(); };
  box.querySelectorAll("[data-ty]").forEach((b) => b.onclick = () => { cand.filter((c) => c.type === b.dataset.ty).forEach((c) => cutSel.add(c.id)); sync(); });
  box.querySelectorAll(".cand input[type=checkbox]").forEach((cb) => cb.addEventListener("change", () => {
    cb.checked ? cutSel.add(cb.dataset.id) : cutSel.delete(cb.dataset.id);
    cb.closest(".cand").classList.toggle("on", cb.checked);
  }));
  box.querySelectorAll(".cand [data-play]").forEach((b) => b.addEventListener("click", () => {
    const c = cand.find((x) => x.id === b.closest(".cand").dataset.id);
    if (b.dataset.play === "before") playRange(Math.max(0, c.startSec - 2), c.endSec + 2, false);
    else {
      // カット後：前後2秒を、候補の区間を飛ばして再生
      const saved = S.cuts;
      S.cuts = normalizeCuts([...S.data.cut || [], { startSec: c.startSec, endSec: c.endSec }]);
      playRange(Math.max(0, c.startSec - 2), c.endSec + 2, true);
      const restore = () => { if (video.paused) { S.cuts = saved; } else setTimeout(restore, 300); };
      setTimeout(restore, 300);
    }
  }));
  $("#cApply").onclick = async () => {
    const ids = cand.filter((c) => cutSel.has(c.id)).map((c) => c.id);
    const reviewer = $("#cReviewer").value.trim();
    if (!reviewer) { toast("承認する人の名前を入れてください"); return; }
    if (!confirm(`${ids.length}件のカットを承認して反映します。よろしいですか？`)) return;
    try {
      if (cutRunId) {
        const j = await api("/api/run_cut_answer", { id: cutRunId, ids, reviewer, note: $("#cNote")?.value || "" });
        watchJob(j.job, () => { cutRunId = null; cutSel = null; openProject(S.P); });
        toast("承認を反映しています。終わったら AI が続きを進めます");
      } else {
        runAction("cut_apply", { ids, reviewer }, () => { cutSel = null; });
      }
    } catch (e) { toast(e.message, 5000); }
  };
}
window.selectCand = function (id) {
  if (sideTab !== "cuts") return;
  const el = $(`.cand[data-id="${CSS.escape(id)}"]`);
  if (el) { el.scrollIntoView({ block: "center" }); el.style.outline = "2px solid var(--accent)"; setTimeout(() => (el.style.outline = ""), 1200); }
  const c = (S.proj.cutReview?.candidates || []).find((x) => x.id === id);
  if (c) seek(Math.max(0, c.startSec - 1));
};

// ======================================================================
// 素材・出力
// ======================================================================
function renderFilesPanel() {
  const p = S.proj;
  const box = $("#sideBody");
  const enc = (rel) => "/api/pfile?p=" + encodeURIComponent(S.P) + "&path=" + encodeURIComponent(rel);
  box.innerHTML = `
    <h4>完成・書き出し（out/）</h4>
    ${p.outputs.length ? p.outputs.map((o) => `<div class="list-item" data-v="out/${esc(o)}">🎬 ${esc(o)}</div>`).join("") : `<div class="muted small">まだありません</div>`}
    <h4>試作（out/previews/）</h4>
    ${p.previews.length ? p.previews.map((o) => `<div class="list-item" data-v="out/previews/${esc(o)}">🎞 ${esc(o)}</div>`).join("") : `<div class="muted small">まだありません</div>`}
    <h4>静止画（work/stills/）</h4>
    <div class="thumbs">${p.stills.map((s) => `<img src="${enc("work/stills/" + s)}" data-img="work/stills/${esc(s)}" title="${esc(s)}">`).join("") || `<span class="muted small">まだありません</span>`}</div>
    <h4>差し込み画像（public/images/）</h4>
    <div class="thumbs">${(p.assets.images || []).map((s) => `<img src="${enc("public/images/" + s)}" data-img="public/images/${esc(s)}" title="${esc(s)}">`).join("") || `<span class="muted small">まだありません</span>`}</div>
    <div class="btnrow"><button id="fAddImg">＋ 画像を追加</button><button id="fReveal">Finder で開く</button></div>
    ${p.humanCheck ? `<div class="notice good small">完成の確認記録があります（${esc(p.humanCheck.reviewer || "")}）</div>` : ""}`;
  box.querySelectorAll("[data-v]").forEach((el) => el.addEventListener("click", () => showVideo(enc(el.dataset.v), el.dataset.v)));
  box.querySelectorAll("[data-img]").forEach((el) => el.addEventListener("click", () => showImage(enc(el.dataset.img), el.dataset.img)));
  $("#fAddImg").onclick = async () => {
    const r = await api("/api/choose", { kind: "file", prompt: "差し込む画像を選んでください" });
    if (!r.path) return;
    await api("/api/add_image", { p: S.P, path: r.path });
    toast("画像を追加しました（画像の段をダブルクリックで配置できます）");
    openProject(S.P);
  };
  $("#fReveal").onclick = () => api("/api/reveal", { p: S.P, path: "out" }).catch(() => api("/api/reveal", { p: S.P, path: "" }));
}
function showVideo(src, title) {
  openModal(`<h2>${esc(title || "")}</h2><video src="${src}" controls autoplay></video><div class="btnrow"><button onclick="closeModal()">閉じる</button></div>`);
}
function showImage(src, title) {
  openModal(`<h2>${esc(title || "")}</h2><img src="${src}"><div class="btnrow"><button onclick="closeModal()">閉じる</button></div>`);
}

// ======================================================================
// 裏の作業（静止画・試作・書き出し・検査）
// ======================================================================
window.runAction = async function (action, extra = {}, onDone) {
  await flushSave();
  try {
    const j = await api("/api/action", { p: S.P, action, ...extra });
    watchJob(j.job, (job) => { onDone && onDone(job); afterJob(job); });
  } catch (e) { toast(e.message, 5000); }
};
const watching = new Map();
function watchJob(job, done) {
  watching.set(job.id, { job, done });
  renderJobBar();
  const poll = async () => {
    let j;
    try { j = await api("/api/job?id=" + job.id); } catch (e) { setTimeout(poll, 2000); return; }
    watching.get(job.id).job = j;
    renderJobBar();
    if (j.status === "queued" || j.status === "running") { setTimeout(poll, 1200); return; }
    const w = watching.get(job.id);
    setTimeout(() => { watching.delete(job.id); renderJobBar(); }, j.status === "done" ? 4000 : 15000);
    w.done && w.done(j);
  };
  setTimeout(poll, 800);
}
function renderJobBar() {
  $("#jobBar").innerHTML = [...watching.values()].map(({ job }) => `
    <div class="jobcard" data-id="${job.id}">
      <div><b>${job.status === "done" ? (job.result?.warnings ? "🟡" : "✅") : job.status === "error" ? "⚠" : "⏳"} ${esc(job.title)}</b>
      <button class="small" data-log="${job.id}">ログ</button>${job.status === "running" ? `<button class="small danger" data-cancel="${job.id}">中止</button>` : ""}</div>
      <div class="last">${esc(job.result?.error || (job.log || []).slice(-1)[0] || "")}</div></div>`).join("");
  $$("#jobBar [data-log]").forEach((b) => b.onclick = () => showJobLog(b.dataset.log));
  $$("#jobBar [data-cancel]").forEach((b) => b.onclick = () => api("/api/job_cancel", { id: b.dataset.cancel }));
}
async function showJobLog(id) {
  const j = await api("/api/job?id=" + id);
  openModal(`<h2>${esc(j.title)}（${esc(j.status)}）</h2>${j.result?.error ? `<div class="notice bad">${esc(j.result.error)}</div>` : ""}<pre class="log">${esc((j.log || []).join("\n"))}</pre>
    <div class="btnrow"><button onclick="closeModal()">閉じる</button></div>`);
}
function afterJob(job) {
  const enc = (rel) => "/api/pfile?p=" + encodeURIComponent(S.P) + "&path=" + encodeURIComponent(rel);
  if (job.status === "error") { toast("⚠ " + (job.result?.error || "失敗しました") + "（ログを確認してください）", 6000); }
  if (job.status !== "done" && job.kind !== "render") { if (job.kind === "qa") showJobLog(job.id); return; }
  if (job.kind === "still" && job.result.image) showImage(enc(job.result.image) + "&v=" + Date.now(), "静止画（完成と同じ見た目）");
  if (job.kind === "preview" && job.result.video) showVideo(enc(job.result.video) + "&v=" + Date.now(), "試作");
  if (job.kind === "render" && job.result.video) {
    openModal(`<h2>${job.status === "done" ? "✅ 書き出しました" : "⚠ 書き出しましたが、検査で指摘があります"}</h2>
      <video src="${enc(job.result.video)}&v=${Date.now()}" controls></video>
      <div class="small muted">${esc(job.result.video)}</div>
      ${job.result.note ? `<div class="notice small">${esc(job.result.note)}</div>` : ""}
      ${job.result.warnings ? `<pre class="log">${esc((job.log || []).slice(-30).join("\n"))}</pre>` : ""}
      ${job.status !== "done" ? `<pre class="log">${esc((job.log || []).slice(-40).join("\n"))}</pre>` : ""}
      <div class="btnrow"><button id="rvReveal">Finder で表示</button><button onclick="closeModal()">閉じる</button></div>`);
    $("#rvReveal").onclick = () => api("/api/reveal", { p: S.P, path: job.result.video });
  }
  if (job.kind === "qa") showJobLog(job.id);
  if (["cut_apply", "cut_review", "contrast", "zoom", "render", "cut_clips"].includes(job.kind)) openProject(S.P);
}

$("#btnQA").addEventListener("click", () => runAction("qa"));
$("#btnStill").addEventListener("click", () => { runAction("still", { sec: curTime() }); toast("静止画を作っています（初回は準備に数分かかることがあります）"); });
$("#btnPreview").addEventListener("click", () => {
  const t = curTime();
  const body = openModal(`<h2>🎞 試作（音付き・縮小）</h2>
    <p class="small muted">元動画の区間を、完成と同じ見た目で書き出します（30〜45秒がおすすめ。音量は本番と同じではありません）。</p>
    <div class="row"><label>開始（元の秒）</label><input type="number" step="0.1" id="pvFrom" value="${Math.max(0, t - 5).toFixed(1)}"></div>
    <div class="row"><label>終了（元の秒）</label><input type="number" step="0.1" id="pvTo" value="${Math.min(S.dur, t + 25).toFixed(1)}"></div>
    <div class="btnrow"><button class="primary" id="pvGo">試作する</button><button onclick="closeModal()">やめる</button></div>`);
  void body;
  $("#pvGo").onclick = () => { closeModal(); runAction("preview", { from: +$("#pvFrom").value, to: +$("#pvTo").value }); };
});
$("#btnExport").addEventListener("click", () => {
  const b = S.proj.bgm || {};
  openModal(`<h2>⬇ 書き出し</h2>
    <p>Remotion で書き出し → 音声の仕上げ（雑音を減らし -14 LUFS）${b.enabled && b.rightsConfirmed ? " → BGM を重ねる" : ""} → 自動検査、の順に行います。</p>
    <div class="small muted">完成ファイル: out/${esc(S.proj.title)}.mp4（長い動画は数十分かかります）</div>
    <div class="row" style="margin-top:10px"><label>同時処理数</label><select id="exConc"><option value="">おまかせ</option><option value="1">1（遅いが安定）</option><option value="2">2</option><option value="4">4</option></select></div>
    <div class="row"><label>自動検査</label><label class="chk"><input type="checkbox" id="exVerify" checked> verify_render で検査する</label></div>
    <p class="small muted">完成の視聴確認の記録と、ショートのループ化・SRT・チャプターの書き出しは、AI に「仕上げて」と頼むとスキルの手順どおりに行います。</p>
    <div class="btnrow"><button class="primary" id="exGo">書き出す</button><button onclick="closeModal()">やめる</button></div>`);
  $("#exGo").onclick = () => { const c = $("#exConc").value; closeModal(); runAction("render", { concurrency: c ? +c : null, verify: $("#exVerify").checked }); };
});

// ======================================================================
// AI：作る・頼む・確認に答える
// ======================================================================
async function openCreate() {
  let prompts = {};
  try { prompts = await api("/api/prompts"); } catch (e) { /* 空 */ }
  const presets = prompts.presets || [];
  openModal(`<h2>🎬 動画を渡して AI で作る</h2>
    <p class="small muted">TotonouMovie の手順（produce → ショート／ロング／アフレコ）を AI が進めます。途中の確認（雰囲気・カット承認・仕上がり・完成）はこの画面に出ます。</p>
    <div class="tabs" id="crKind" style="padding:0 0 8px;border:0"><button data-k="create" class="on">話している動画</button><button data-k="voiceover">アフレコ（声＋素材フォルダ）</button></div>
    <div class="row"><label id="crVideoLab">動画</label><input type="text" id="crVideo" class="grow" placeholder="/Users/…/IMG_0001.MOV"><button id="crChoose">選ぶ</button></div>
    <div class="row hidden" id="crMatRow"><label>素材フォルダ</label><input type="text" id="crMat" class="grow"><button id="crChooseMat">選ぶ</button></div>
    <h3>オリジナルの指示（選んだものを足します）</h3>
    <div>${presets.length ? presets.map((p, i) => `<label class="chk" style="margin-right:12px"><input type="checkbox" class="crPreset" value="${esc(p.name)}"> ${esc(p.name)}</label>`).join("") : `<span class="muted small">まだありません（「✍ プロンプト」で作れます）</span>`}</div>
    <h3>今回だけの追加の指示</h3>
    <textarea id="crExtra" placeholder="例：画像は ~/Pictures/talk に入っています。BGM は ~/Music/calm.mp3（権利確認済み）。表記は「山田太郎」。"></textarea>
    <div class="btnrow"><button class="primary" id="crGo">AI で作り始める</button><button id="crShow">渡すプロンプトを見る</button><button onclick="closeModal()">やめる</button></div>
    <pre class="log hidden" id="crPrompt"></pre>`);
  let kind = "create";
  $$("#crKind button").forEach((b) => b.onclick = () => {
    kind = b.dataset.k;
    $$("#crKind button").forEach((x) => x.classList.toggle("on", x === b));
    $("#crMatRow").classList.toggle("hidden", kind !== "voiceover");
    $("#crVideoLab").textContent = kind === "voiceover" ? "声の録音" : "動画";
  });
  $("#crChoose").onclick = async () => { const r = await api("/api/choose", { kind: "file", prompt: kind === "voiceover" ? "声の録音を選んでください" : "編集する動画を選んでください" }); if (r.path) $("#crVideo").value = r.path; };
  $("#crChooseMat").onclick = async () => { const r = await api("/api/choose", { kind: "folder", prompt: "素材フォルダを選んでください" }); if (r.path) $("#crMat").value = r.path; };
  const body = (dry) => ({ kind, video: $("#crVideo").value.trim(), materials: $("#crMat").value.trim(), extra: $("#crExtra").value,
    presets: $$(".crPreset").filter((c) => c.checked).map((c) => c.value), dryRun: dry });
  $("#crShow").onclick = async () => {
    try { const j = await api("/api/run_start", body(true)); $("#crPrompt").textContent = j.prompt; $("#crPrompt").classList.remove("hidden"); }
    catch (e) { toast(e.message, 4000); }
  };
  $("#crGo").onclick = async () => {
    try {
      const j = await api("/api/run_start", body(false));
      closeModal();
      openRun(j.run.id);
    } catch (e) { toast(e.message, 5000); }
  };
}

function renderAIPanel() {
  const box = $("#sideBody");
  box.innerHTML = `
    <h4>AI に頼む（このプロジェクト）</h4>
    <div class="row"><select id="aiKind" class="grow"><option value="fix">直してもらう（fix の手順：字幕・話者・カット・演出など）</option><option value="free">自由に頼む（効果音を足して・章を作って・仕上げて 等）</option></select></div>
    <textarea id="aiReq" rows="4" placeholder="例：1分20秒あたりの字幕「機会」を「機械」に。冒頭の効果音を減らして。"></textarea>
    <div id="aiPresets" class="small"></div>
    <div class="btnrow"><button class="primary" id="aiGo">AI に頼む</button></div>
    <h4>このプロジェクトの AI の作業</h4><div id="aiRuns" class="small muted">読み込み中…</div>`;
  api("/api/prompts").then((pr) => {
    $("#aiPresets").innerHTML = (pr.presets || []).map((p) => `<label class="chk" style="margin-right:10px"><input type="checkbox" class="aiPreset" value="${esc(p.name)}"> ${esc(p.name)}</label>`).join("");
  }).catch(() => {});
  $("#aiGo").onclick = async () => {
    await flushSave();
    try {
      const j = await api("/api/run_start", { kind: $("#aiKind").value, p: S.P, request: $("#aiReq").value, presets: $$(".aiPreset").filter((c) => c.checked).map((c) => c.value) });
      openRun(j.run.id);
    } catch (e) { toast(e.message, 5000); }
  };
  api("/api/runs?p=" + encodeURIComponent(S.P)).then((j) => {
    $("#aiRuns").innerHTML = j.runs.length ? j.runs.map(runRowHTML).join("") : "まだありません";
    $$("#aiRuns .runrow").forEach((r) => r.onclick = () => openRun(r.dataset.id));
  });
}
const RUN_ST = { running: "⏳ 作業中", waiting: "✋ 確認待ち", done: "✅ 完了", error: "⚠ エラー", stopped: "⏹ 停止" };
function runRowHTML(r) {
  return `<div class="runrow" data-id="${r.id}"><div><b>${esc(r.title)}</b></div>
    <div class="st ${r.status === "waiting" ? "warn" : r.status === "error" ? "err" : "muted"}">${RUN_ST[r.status] || r.status}・${new Date(r.updated * 1000).toLocaleString("ja-JP")}</div></div>`;
}

$("#btnAI").addEventListener("click", async () => {
  const j = await api("/api/runs");
  openModal(`<h2>🤖 AI の作業</h2>${j.runs.length ? j.runs.map(runRowHTML).join("") : `<p class="muted">まだありません。「AIで作る」から始めてください。</p>`}
    <div class="btnrow"><button onclick="closeModal()">閉じる</button></div>`);
  $$("#modalBody .runrow").forEach((r) => r.onclick = () => openRun(r.dataset.id));
});

// AI の確認待ちの数をバッジに出す
async function pollRuns() {
  try {
    const j = await api("/api/runs");
    const n = j.runs.filter((r) => r.status === "waiting").length;
    const b = $("#aiBadge");
    b.textContent = n;
    b.classList.toggle("hidden", !n);
    const running = j.runs.some((r) => r.status === "running");
    $("#btnAI").title = running ? "AI が作業中です" : "AI の作業と確認待ち";
  } catch (e) { /* 無視 */ }
  setTimeout(pollRuns, 5000);
}
setTimeout(pollRuns, 1500);

let runView = null;

// AI の作業の段階（アイコン・表示名・トトノちゃんのせりふ）
const STAGES = [
  { id: "recv", label: "受け取る", icon: "film", say: "動画を受け取ったよ。準備をしているね。" },
  { id: "trans", label: "文字起こし", icon: "transcribe", say: "いま、話している言葉を文字にしているよ。少し待っててね。" },
  { id: "q1", label: "確認①", icon: "question", say: "確認だよ。雰囲気とテンポを選んでね。迷ったら一番上のおすすめで大丈夫。" },
  { id: "cut", label: "カット承認", icon: "scissors", say: "カットの候補を作っているよ。" },
  { id: "telop", label: "字幕", icon: "subtitle", say: "字幕を作って、読みやすく整えているよ。" },
  { id: "fx", label: "演出", icon: "sparkle", say: "効果音や動きを入れているよ。" },
  { id: "q3", label: "仕上がり確認", icon: "question", say: "仕上がりを確認してね。気になる所は、編集画面で直してからでも大丈夫。" },
  { id: "render", label: "書き出し", icon: "export", say: "書き出し中だよ。長い動画だと少し時間がかかるよ。" },
  { id: "check", label: "検査", icon: "inspect", say: "できた動画を検査しているよ。" },
  { id: "done", label: "完成", icon: "trophy", say: "おつかれさま！完成した動画は、素材と出力のタブにあるよ。" },
];
const STAGE_RULES = [
  [/init_project|probe_video|tm_style|tm_settings/, "recv"], [/transcribe|fix_transcript|skin_retouch/, "trans"],
  [/detect_|gen_cut_plan|cut_review|cue_cuts/, "cut"], [/gen_telopdata|lint_telop|caption_contrast|apply_expression|gen_image_plan/, "telop"],
  [/gen_se_plan|motion_graphics|ensure_se|jumpcut_zoom|shorts_hook|gen_highlight|section_titles/, "fx"],
  [/render_project.py render|postprocess_audio|mix_bgm|shorts_loop|gen_srt/, "render"], [/verify_render|recheck_speech|qa_static/, "check"],
];
const SAY_ID = { recv: "run_recv", trans: "run_trans", q1: "run_q1", cut: "run_cut", telop: "run_telop", fx: "run_fx", q3: "run_q3", render: "run_render", check: "run_check", done: "run_done" };
function stageOf(r, evts) {
  const order = STAGES.map((x) => x.id);
  let idx = 0;
  for (const e of evts) for (const [re, st] of STAGE_RULES) if (re.test(e.text)) idx = Math.max(idx, order.indexOf(st));
  const q = r.question;
  if (q && r.status !== "running") {
    const t = (q.title || "") + q.kind;
    if (q.kind === "done") idx = order.indexOf("done");
    else if (q.kind === "review" || /④/.test(t)) idx = order.indexOf("done");
    // 確認の番のときは、その確認の段階を「いま」にする（先に進んだ作業の記録があっても）
    else if (q.kind === "cut_approval" || /②/.test(t)) idx = order.indexOf("cut");
    else if (/③/.test(t)) idx = order.indexOf("q3");
    else if (/①/.test(t)) idx = order.indexOf("q1");
  }
  return idx;
}
function lineFor(r, stage) {
  const q = r.question;
  if (r.status === "error") return ["うまくいかなかったみたい。くわしい記録を見て、続けてくださいと送ってみてね。", "run_error", "think"];
  if (r.status === "stopped") return ["作業を止めたよ。続けたいときは、AI タブで続きを頼んでね。", "run_stopped", "think"];
  if (r.status === "waiting" && q) {
    if (q.kind === "cut_approval") return ["カットの承認だよ。下のボタンを押して、聞き比べながら選んでね。", "run_q2", "point"];
    if (q.kind === "review") return ["完成したよ！最後まで見て、よければオーケーを選んでね。", "run_q4", "cheer"];
    if (q.kind === "done") return [STAGES[9].say, "run_done", "good"];
    if (stage.id === "q1" || stage.id === "q3") return [stage.say, SAY_ID[stage.id], "point"];
    return ["確認したいことがあるみたい。答えを選んで送ってね。", "run_ask", "point"];
  }
  return [stage.say, SAY_ID[stage.id], stage.id === "done" ? "good" : "explain"];
}

async function openRun(id) {
  if (runView && runView.chara) runView.chara.remove();
  runView = { id, since: 0, events: [] };
  openModal(`<div class="run2">
    <div class="run-head"><h2 id="rvTitle">AI の作業</h2><span class="pill" id="rvPill"></span><span class="small muted" id="rvCost"></span></div>
    <div class="stepper" id="rvSteps"></div>
    <div class="run-main">
      <div class="run-chara" id="rvChara"></div>
      <div>
        <div id="rvNow"></div>
        <div id="rvQuestion"></div>
      </div>
    </div>
    <details class="run-log"><summary>くわしい記録（AI がしたこと）</summary><div id="rvEvents"></div></details>
    <div class="run-foot"><button id="rvStop" class="danger">止める</button><button id="rvOpenP" class="hidden">編集画面を開く</button><button onclick="closeModal()">閉じる（裏で続きます）</button></div>
  </div>`, { width: "min(1080px,96vw)" });
  runView.chara = new Totono.Chara($("#rvChara"), { size: 170, pose: "explain" });
  $("#rvStop").onclick = () => api("/api/run_stop", { id });
  refreshRun();
}

async function refreshRun() {
  if (!runView || $("#modal").classList.contains("hidden") || !$("#rvEvents")) {
    if (runView && runView.chara) runView.chara.remove();
    runView = null; return;
  }
  const v = runView;
  let r;
  try { r = await api(`/api/run?id=${v.id}&since=${v.since}`); } catch (e) { setTimeout(refreshRun, 2000); return; }
  if (runView !== v) return;
  v.since = r.eventCount;
  v.events.push(...r.events);
  $("#rvTitle").textContent = r.title;
  const pill = $("#rvPill");
  pill.className = "pill " + (r.status === "waiting" && r.question?.kind !== "done" ? "waiting" : r.status);
  pill.textContent = { running: "⏳ AI が作業中", waiting: "✋ あなたの番です", done: "✅ 完了", error: "⚠ エラー", stopped: "⏹ 止めました" }[r.status] || r.status;
  if (r.question?.kind === "done") pill.textContent = "✅ 完了";
  $("#rvCost").textContent = r.cost ? `約 $${r.cost.toFixed(2)}` : "";
  const ev = $("#rvEvents");
  const atBottom = ev.scrollTop + ev.clientHeight >= ev.scrollHeight - 30;
  ev.insertAdjacentHTML("beforeend", r.events.map((e) => `<div class="ev ${e.role}">${esc(e.text)}</div>`).join(""));
  if (atBottom) ev.scrollTop = ev.scrollHeight;
  $("#rvStop").classList.toggle("hidden", r.status !== "running");
  // 段階の表示（AI で作るときだけ）
  const isCreate = r.kind === "create" || r.kind === "voiceover";
  const si = stageOf(r, v.events);
  const stage = STAGES[si];
  $("#rvSteps").classList.toggle("hidden", !isCreate);
  if (isCreate) {
    $("#rvSteps").innerHTML = STAGES.map((x, i) => `<div class="stp ${i < si ? "done" : i === si ? "cur" + (r.status === "running" ? " working" : "") : ""}">
      <div class="ic"><img src="/static/icons/${x.icon}.png" alt=""></div><div>${x.label}</div></div>`).join("");
  }
  // いまの様子（作業中のとき）
  const last = [...v.events].reverse().find((e) => e.role === "assistant" || e.role === "tool");
  $("#rvNow").innerHTML = r.status === "running" ? `<div class="run-card"><div class="run-now"><img src="/static/icons/${isCreate ? stage.icon : "gear"}.png" alt="">
      <div><div class="big">${isCreate ? esc(stage.label) + "をしています" : "AI が作業しています"}</div><div class="last">${esc(last ? last.text.split("\n")[0].slice(0, 90) : "準備中…")}</div></div></div>
      <p class="small muted" style="margin:10px 0 0">この画面を閉じても、AI は裏で作業を続けます。確認の順番が来たら、上の 🤖 AI に赤い数字が付きます。</p></div>` : "";
  const pname = r.project ? r.project.split("/").pop() : null;
  if (pname && S.projects.every((p) => p.path !== r.project)) { try { S.projects = (await api("/api/projects")).projects; fillProjSelect(); } catch (e) { /* 空 */ } }
  const proj = S.projects.find((p) => p.path === r.project);
  $("#rvOpenP").classList.toggle("hidden", !proj);
  $("#rvOpenP").onclick = () => { closeModal(); openProject(proj.name); };
  const key = r.status + ":" + si + ":" + (r.question?.kind || "");
  if (key !== v.lastKey) {
    v.lastKey = key;
    const [text, id, pose] = lineFor(r, stage);
    v.chara.say(text, { id, pose });
  }
  if (r.status !== v.lastStatus) {
    v.lastStatus = r.status;
    renderQuestion(r, proj);
    if (r.status !== "running" && proj && S.P === proj.name) openProject(S.P);
  }
  setTimeout(refreshRun, r.status === "running" ? 1500 : 4000);
}

function mediaURL(path) { return "/api/afile?path=" + encodeURIComponent(path) + "&v=" + Date.now(); }

function renderQuestion(r, proj) {
  const box = $("#rvQuestion");
  const q = r.question;
  if (!q || r.status === "running") { box.innerHTML = ""; return; }
  const imgs = (q.images || []).map((p) => `<img src="${mediaURL(p)}" title="${esc(p)}">`).join("");
  const vids = (q.videos || []).map((p) => `<video src="${mediaURL(p)}#t=0.8" preload="metadata" controls></video><div class="small muted">${esc(p)}</div>`).join("");
  const qs = (q.questions || []).map((qq, qi) => `
    <div class="q">${esc(qq.question)}</div>
    ${(qq.options || []).map((o, oi) => `<label class="opt"><input type="${qq.multiSelect ? "checkbox" : "radio"}" name="q${qi}" value="${esc(o.label)}" ${!qq.multiSelect && oi === 0 ? "checked" : ""}> ${esc(o.label)}${o.description ? `<span class="d">${esc(o.description)}</span>` : ""}</label>`).join("")}
    <input type="text" class="qOther" data-qi="${qi}" placeholder="その他・補足（自由に書けます）">`).join("");
  const isCut = q.kind === "cut_approval";
  const isDone = q.kind === "done";
  box.innerHTML = `<div class="qbox run-card ask">
    <h3><img src="/static/icons/${isDone ? "trophy" : isCut ? "scissors" : "question"}.png" alt="">${esc(q.title || "確認")}</h3>
    ${q.text ? `<div class="qbody small" style="margin-top:6px">${esc(q.text)}</div>` : ""}
    ${q.body ? `<div class="qbody" style="margin-top:6px">${esc(q.body)}</div>` : ""}
    <div class="thumbs" style="margin-top:6px">${imgs}</div>${vids}
    ${isCut ? `<div class="notice small" style="margin-top:8px">カットの承認は編集画面の「カット承認」で、候補を聞いて選んで行います。</div>
      <div class="btnrow"><button class="primary" id="qCut" ${proj ? "" : "disabled"}>✂ カット承認を開く</button></div>` : qs}
    ${isCut ? "" : `<h4 style="margin:12px 0 4px;font-size:12px;color:var(--muted)">${(q.questions || []).length ? "まとめての補足（なければ空のままで OK）" : "AI への返事"}</h4><textarea id="qFree" rows="2" placeholder="${isDone ? "追加で頼みたいことがあれば" : "答え・指示を書いてください"}"></textarea>
      <div class="btnrow"><button class="primary" id="qSend">${isDone ? "追加で頼む" : "答えを送って続ける"}</button></div>`}
  </div>`;
  box.querySelectorAll(".thumbs img").forEach((im) => im.onclick = () => window.open(im.src));
  if (isCut) {
    $("#qCut").onclick = async () => {
      closeModal();
      await openProject(proj.name);
      cutRunId = r.id;
      cutSel = null;
      window.showSideTab("cuts");
    };
    return;
  }
  $("#qSend").onclick = async () => {
    const lines = [];
    (q.questions || []).forEach((qq, qi) => {
      const sel = $$(`#rvQuestion input[name="q${qi}"]:checked`).map((x) => x.value);
      const other = $(`#rvQuestion .qOther[data-qi="${qi}"]`).value.trim();
      lines.push(`【${qq.question}】 ${sel.join("、") || "（選択なし）"}${other ? "／補足: " + other : ""}`);
    });
    const free = $("#qFree").value.trim();
    if (free) lines.push(free);
    if (!lines.length || (lines.every((l) => l.includes("（選択なし）")) && !free)) { toast("答えを選ぶか書いてください"); return; }
    try {
      await api("/api/run_answer", { id: r.id, text: lines.join("\n") });
      runView.lastStatus = "running";
      box.innerHTML = `<div class="run-card"><div class="muted">送りました。AI が続きを進めています…</div></div>`;
    } catch (e) { toast(e.message, 5000); }
  };
}

// ======================================================================
// プロンプトの編集
// ======================================================================
$("#btnPrompts").addEventListener("click", openPrompts);
async function openPrompts() {
  const pr = await api("/api/prompts");
  const D = pr._defaults || {};
  const F = [["create", "AIで作る（話している動画）", "{video} {extra}"], ["voiceover", "AIで作る（アフレコ）", "{video} {materials} {extra}"],
    ["fix", "直してもらう", "{project} {request} {extra}"], ["free", "自由に頼む", "{project} {request} {extra}"],
    ["always", "毎回足す指示", "すべての依頼の最後に足します"], ["system", "AI への前提（上級者向け）", "確認のしかた（tm-ask）の決まりを含みます。消すと画面で確認できなくなります"]];
  openModal(`<h2>✍ プロンプト</h2>
    <p class="small muted">AI（Claude Code）に渡す文章です。書き換えは ~/.totonoumovie/prompts.json に保存され、元の既定値はいつでも戻せます。</p>
    <h3>オリジナルの指示（作るとき・頼むときに選んで足せます）</h3>
    <div id="pPresets">${(pr.presets || []).map(presetRow).join("")}</div>
    <button class="small" id="pAddPreset">＋ 指示を追加</button>
    ${F.map(([k, label, hint]) => `<h3>${label} ${pr._overridden?.includes(k) ? `<span class="warn small">（変更あり）</span> <button class="small" data-reset="${k}">既定に戻す</button>` : ""}</h3>
      <div class="small muted">${esc(hint)}</div><textarea data-p="${k}" rows="${k === "system" ? 12 : 4}">${esc(pr[k] || "")}</textarea>`).join("")}
    <h3>AI が使ってよい道具（上級者向け）</h3>
    <textarea id="pTools" rows="3" style="font-family:monospace;font-size:11px">${esc((pr.allowedTools || []).join(", "))}</textarea>
    <div class="row"><label>モデル</label><input type="text" id="pModel" value="${esc(pr.model || "")}" placeholder="空なら claude の既定（例: opus / sonnet）"></div>
    <div class="btnrow"><button class="primary" id="pSave">保存</button><button onclick="closeModal()">閉じる</button></div>`, { width: "min(1000px,96vw)" });
  $("#pAddPreset").onclick = () => $("#pPresets").insertAdjacentHTML("beforeend", presetRow({ name: "", text: "" }));
  $("#pPresets").addEventListener("click", (e) => { if (e.target.dataset.del != null) e.target.closest(".preset").remove(); });
  $$("[data-reset]").forEach((b) => b.onclick = () => { $(`textarea[data-p="${b.dataset.reset}"]`).value = D[b.dataset.reset] || ""; });
  $("#pSave").onclick = async () => {
    const out = { presets: $$("#pPresets .preset").map((r) => ({ name: r.querySelector("input").value.trim(), text: r.querySelector("textarea").value.trim() })).filter((p) => p.name && p.text),
      allowedTools: $("#pTools").value.split(",").map((s) => s.trim()).filter(Boolean), model: $("#pModel").value.trim() };
    $$("textarea[data-p]").forEach((t) => (out[t.dataset.p] = t.value));
    await api("/api/prompts", out);
    toast("プロンプトを保存しました");
    closeModal();
  };
}
function presetRow(p) {
  return `<div class="preset"><input type="text" value="${esc(p.name)}" placeholder="名前（例：テンポよく）"><textarea rows="2" placeholder="AI への指示">${esc(p.text)}</textarea><button class="small danger" data-del>✕</button></div>`;
}

// ======================================================================
// ツアー（トトノちゃん）
// ======================================================================
$("#btnTour").addEventListener("click", () => Totono.startTour(S.P ? "editor" : "home"));
// はじめて開いた画面では、自動でツアーを始める
window.maybeAutoTour = function (name) {
  if (!Totono.tourSeen(name)) setTimeout(() => Totono.startTour(name), 900);
};
