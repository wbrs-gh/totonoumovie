// ======================================================================
// 自分好み（マイスタイル・スキル・表記辞書・設定・効果音・拠点と引き継ぎ）
// どれも Claude Code の TotonouMovie と同じファイルを読み書きする（どちらで育てても両方で使える）
// ======================================================================
const MINE = { tab: "style", data: null };
const MINE_TABS = [["style", "🎨 マイスタイル"], ["skill", "🧩 スキル"], ["gloss", "📖 表記辞書"], ["set", "⚙ 設定"], ["se", "🔊 効果音"], ["base", "🏠 拠点・引き継ぎ"]];

async function loadMine() { MINE.data = await api("/api/mine"); return MINE.data; }

$("#btnMine").addEventListener("click", () => openMine());
async function openMine(tab) {
  if (tab) MINE.tab = tab;
  try { await loadMine(); } catch (e) { return toast(e.message, 5000); }
  openModal(`<h2>🌱 自分好み</h2>
    <p class="small muted">使うほど自分に合っていくように、見た目・スキル・表記・設定をここで育てます。Claude Code だけで使ったときと同じ場所に保存されるので、どちらで育てても両方で使えます。</p>
    <div class="tabs" id="mineTabs" style="padding:0 0 8px;border:0;flex-wrap:wrap">${MINE_TABS.map(([k, l]) => `<button data-t="${k}">${l}</button>`).join("")}</div>
    <div id="mineBody"></div>
    <div class="btnrow"><button onclick="closeModal()">閉じる</button></div>`, { width: "min(1000px,96vw)" });
  $$("#mineTabs button").forEach((b) => b.onclick = () => { MINE.tab = b.dataset.t; renderMine(); });
  renderMine();
}

function renderMine() {
  $$("#mineTabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === MINE.tab));
  const f = { style: mineStyleTab, skill: mineSkillTab, gloss: mineGlossTab, set: mineSetTab, se: mineSeTab, base: mineBaseTab }[MINE.tab];
  f($("#mineBody"));
}
async function mineReload() { await loadMine(); renderMine(); }
async function minePost(body, okMsg) {
  try { const j = await api("/api/mine", body); if (okMsg) toast(okMsg); return j; }
  catch (e) { toast(e.message, 6000); throw e; }
}
function mineAskAI(request) {
  // 特定の動画ではない依頼（設定・スキル作りなど）を AI に頼む
  return api("/api/run_start", { kind: "base", request }).then((j) => { closeModal(); openRun(j.run.id); }).catch((e) => toast(e.message, 5000));
}

// ---------- マイスタイル ----------
function styleSummary(s) {
  const ch = s.chapters || {};
  return [s.tone && `雰囲気 ${s.tone}`, s.tempo && `テンポ ${s.tempo}`, `字幕 ${s.captionStyle || "標準"}`,
    s.seEnabled === false ? "効果音なし" : (s.sePreset && `効果音 ${s.sePreset}`), s.skin != null && `美肌 ${s.skin}`,
    ch.cards != null && `章カード ${ch.cards ? "あり" : "なし"}${ch.cardSec ? `（${ch.cardSec}秒）` : ""}`,
    s.imageLayout && `画像 ${s.imageLayout}`, s.bgm ? `BGM ${s.bgm}` : "BGM なし", `表記 ${s.glossary.length}語`].filter(Boolean).join("／");
}
async function mineStyleTab(box) {
  const d = MINE.data;
  let presets = [];
  try { presets = (await api("/api/prompts")).presets || []; } catch (e) { /* 空 */ }
  const projOpts = [...d.projects.map((p) => `<option value="${esc(p.path)}">${esc(p.title)}</option>`),
    ...d.legacy.map((p) => `<option value="${esc(p.path)}">（前の作業フォルダ）${esc(p.title)}</option>`)].join("");
  box.innerHTML = `
    <p class="small muted">気に入った見た目（雰囲気・テンポ・字幕・効果音・美肌・章カード・画像の並べ方・BGM・表記）の束です。「AIで作る」のときに選べます。メモに書いたことは、そのマイスタイルを使う動画で毎回守るルールになります（Claude Code だけで使うときも）。</p>
    ${d.styles.length ? d.styles.map((s) => `
      <div class="mine-card" data-name="${esc(s.name)}">
        <div class="mine-card-h"><b>${esc(s.name)}</b> <span class="pill">${esc(s.modeLabel)}</span> <span class="muted small">${esc((s.updatedAt || "").slice(0, 10))}</span>
          <span style="flex:1"></span><button class="small" data-act="rename">名前を変える</button> <button class="small danger" data-act="del">消す</button></div>
        <div class="small muted">${esc(styleSummary(s))}</div>
        ${s.glossary.length ? `<div class="small">表記：${s.glossary.slice(0, 12).map((g) => esc(g.correct || "")).join("、")}${s.glossary.length > 12 ? " ほか" : ""}</div>` : ""}
        <div class="small" style="margin-top:6px">メモ（このスタイルで毎回守る編集のルール）</div>
        <textarea rows="3" class="mine-notes" placeholder="例：テンポは詰め気味。人名は必ず確認してから字幕に。">${esc(s.notes)}</textarea>
        ${presets.length ? `<div class="small">いつもの指示を入れる：${presets.map((p, i) => `<button class="small" data-preset="${i}">＋ ${esc(p.name)}</button>`).join(" ")}</div>` : ""}
        <div class="btnrow"><button class="small primary" data-act="notes">メモを保存</button></div>
      </div>`).join("") : `<p class="muted">まだありません。下の「動画からマイスタイルを作る」か、AI の完成の確認のあとに保存できます。</p>`}
    <h3>動画からマイスタイルを作る</h3>
    <p class="small muted">前に作った動画（前の版や Claude Code だけで作ったものも）の見た目を取り出して保存します。</p>
    ${projOpts ? `<div class="row"><label>動画</label><select id="msProj" class="grow">${projOpts}</select></div>
    <div class="row"><label>名前</label><input type="text" id="msName" class="grow" placeholder="例：語りのリール"></div>
    ${presets.length ? `<div class="row"><label>メモに入れる</label><div>${presets.map((p) => `<label class="chk" style="margin-right:10px"><input type="checkbox" class="msPreset" value="${esc(p.name)}"> ${esc(p.name)}</label>`).join("")}</div></div>` : ""}
    <div class="btnrow"><button class="primary" id="msSave">マイスタイルとして保存</button></div>` : `<p class="muted small">まだ動画がありません。</p>`}`;
  $$(".mine-card", box).forEach((c) => {
    const name = c.dataset.name;
    c.addEventListener("click", async (e) => {
      const t = e.target;
      if (t.dataset.preset != null) {
        const p = presets[+t.dataset.preset];
        const ta = $(".mine-notes", c);
        ta.value = (ta.value.trim() ? ta.value.trim() + "\n" : "") + `・${p.name}：${p.text}`;
      } else if (t.dataset.act === "notes") {
        await minePost({ op: "style_notes", name, notes: $(".mine-notes", c).value }, "メモを保存しました");
        mineReload();
      } else if (t.dataset.act === "rename") {
        const nn = await askText("新しい名前", name);
        if (nn && nn !== name) { await minePost({ op: "style_rename", name, newName: nn }, "名前を変えました"); mineReload(); }
      } else if (t.dataset.act === "del") {
        if (await askConfirm(`マイスタイル「${name}」を消しますか？（元に戻せません）`)) { await minePost({ op: "style_delete", name }, "消しました"); mineReload(); }
      }
    });
  });
  const go = $("#msSave");
  if (go) go.onclick = async () => {
    const name = $("#msName").value.trim();
    if (!name) return toast("名前を入れてください");
    const picked = $$(".msPreset").filter((c) => c.checked).map((c) => presets.find((p) => p.name === c.value));
    const notes = picked.length ? picked.map((p) => `・${p.name}：${p.text}`).join("\n") : null;
    const exists = MINE.data.styles.some((s) => s.name === name);
    if (exists && !(await askConfirm(`「${name}」はもうあります。上書きしますか？`))) return;
    go.disabled = true; go.textContent = "保存中…";
    try { await minePost({ op: "style_save", p: $("#msProj").value, name, notes, overwrite: exists }, "マイスタイルを保存しました"); mineReload(); }
    finally { go.disabled = false; go.textContent = "マイスタイルとして保存"; }
  };
}

// ---------- スキル ----------
function mineSkillTab(box) {
  const s = MINE.data.skills;
  box.innerHTML = `
    <p class="small muted">「AIで作る」「AI に頼む」のときに、使うスキルを選べます。自作スキルはこの拠点の中（.claude/skills）にだけ作るので、動画編集以外の作業には読み込まれません。</p>
    <h3>自作スキル <button class="small" id="skOpen">フォルダを開く</button></h3>
    ${s.mine.length ? s.mine.map((k) => `<div class="mine-card" data-name="${esc(k.name)}"><div class="mine-card-h"><b>${esc(k.name)}</b><span style="flex:1"></span>
        <button class="small" data-act="edit">直す</button> <button class="small danger" data-act="del">消す</button></div>
        <div class="small muted">${esc(k.description)}</div></div>`).join("") : `<p class="muted small">まだありません。</p>`}
    <div id="skForm"></div>
    <div class="btnrow"><button id="skNew">＋ 自分で書いて作る</button></div>
    <h3>AI にスキルを作ってもらう</h3>
    <textarea id="skAI" rows="3" placeholder="例：字幕で「です・ます」を「だ・である」にそろえるスキルを作って。ショートの最後は必ず「フォローしてね」で終える、など。"></textarea>
    <div class="btnrow"><button class="primary" id="skAIGo">AI に作ってもらう</button></div>
    <h3>TotonouMovie のスキル（${s.plugin.length}）</h3>
    <div class="small">${s.plugin.map((k) => `<div style="margin-bottom:4px"><b>${esc(k.name)}</b> <span class="muted">${esc(k.description.slice(0, 120))}${k.description.length > 120 ? "…" : ""}</span></div>`).join("")}</div>`;
  $("#skOpen").onclick = () => minePost({ op: "reveal", what: "skills" });
  $("#skNew").onclick = () => skillForm({ name: "", description: "", body: "" });
  $("#skAIGo").onclick = () => {
    const t = $("#skAI").value.trim();
    if (!t) return toast("どんなスキルにしたいか書いてください");
    mineAskAI("次のような自作スキルを作ってください。\n" + t);
  };
  $$(".mine-card", box).forEach((c) => c.addEventListener("click", async (e) => {
    const k = s.mine.find((x) => x.name === c.dataset.name);
    if (e.target.dataset.act === "edit") skillForm(k, k.name);
    if (e.target.dataset.act === "del" && (await askConfirm(`スキル「${k.name}」を消しますか？`))) { await minePost({ op: "skill_delete", name: k.name }, "消しました"); mineReload(); }
  }));
}
function skillForm(k, oldName) {
  $("#skForm").innerHTML = `<div class="mine-card">
    <div class="row"><label>名前</label><input type="text" id="skName" class="grow" value="${esc(k.name)}" placeholder="英小文字とハイフン（例：my-telop-rules）"></div>
    <div class="row"><label>いつ使うか</label><input type="text" id="skDesc" class="grow" value="${esc(k.description)}" placeholder="例：字幕を作る・直すときに使う。語尾をそろえる自分のルール"></div>
    <div class="small muted">中身（AI が従う手順や決まり。箇条書きでOK）</div>
    <textarea id="skBody" rows="8">${esc(k.body || "")}</textarea>
    <div class="btnrow"><button class="primary" id="skSave">保存</button><button id="skCancel">やめる</button></div></div>`;
  $("#skCancel").onclick = () => ($("#skForm").innerHTML = "");
  $("#skSave").onclick = async () => {
    await minePost({ op: "skill_save", name: $("#skName").value.trim(), description: $("#skDesc").value, body: $("#skBody").value, oldName }, "スキルを保存しました");
    mineReload();
  };
}

// ---------- 表記辞書 ----------
function mineGlossTab(box) {
  const g = MINE.data.glossary;
  const row = (e) => `<div class="gl-row"><input type="text" class="glW" value="${esc(e.wrong)}" placeholder="間違って出る字"> → <input type="text" class="glC" value="${esc(e.correct)}" placeholder="正しい表記"> <button class="small danger" data-del>✕</button></div>`;
  box.innerHTML = `
    <p class="small muted">全部の動画で使う共通の辞書です。文字起こし・誤字の修正・字幕で使われます（動画ごとの表記は、マイスタイルや AI への指示で）。</p>
    <h3>誤字の直し</h3>
    <div id="glRows">${g.entries.map(row).join("")}</div>
    <button class="small" id="glAdd">＋ 追加</button>
    <h3>字幕で途中で切らない言葉</h3>
    <textarea id="glTerms" rows="3" placeholder="1行に1つ（例：Claude Code）">${esc(g.terms.join("\n"))}</textarea>
    <div class="btnrow"><button class="primary" id="glSave">保存</button></div>`;
  $("#glAdd").onclick = () => $("#glRows").insertAdjacentHTML("beforeend", row({ wrong: "", correct: "" }));
  $("#glRows").addEventListener("click", (e) => { if (e.target.dataset.del != null) e.target.closest(".gl-row").remove(); });
  $("#glSave").onclick = async () => {
    const entries = $$("#glRows .gl-row").map((r) => ({ wrong: $(".glW", r).value, correct: $(".glC", r).value }));
    await minePost({ op: "glossary", entries, terms: $("#glTerms").value.split("\n") }, "表記辞書を保存しました");
    mineReload();
  };
}

// ---------- 設定 ----------
const SET_FIELDS = [
  ["reviewerName", "確認者の名前", "text", "完成の確認記録に残る名前"],
  ["deliveryDir", "完成動画のコピー先", "text", "空なら、コピーしない"],
  ["skinRetouch.portrait", "美肌の強さ（縦）", "number", "0〜100。既定 60"],
  ["skinRetouch.landscape", "美肌の強さ（横）", "number", "0〜100。既定 40"],
  ["cues.vocative", "合図の呼びかけ", "text", "撮影中の合図の最初の言葉（既定「編集さん」）"],
  ["cues.chapter", "章の合図", "list", "カンマ区切り（既定「ここに章」）"],
  ["cues.image", "画像の合図", "list", "カンマ区切り（既定「ここに画像」）"],
  ["cues.list", "一覧の合図", "list", "カンマ区切り（既定「ここに一覧」）"],
  ["chapters.cardSec", "章カードの秒数", "number", "既定 2"],
  ["chapters.cardSfx", "章カードの効果音", "text", "ファイル名（既定 transition.mp3）。空で既定"],
];
async function mineSetTab(box) {
  box.innerHTML = `<p class="muted">読み込み中…</p>`;
  let v;
  try { v = await api("/api/mine_settings"); } catch (e) { box.innerHTML = `<p class="warn">${esc(e.message)}</p>`; return; }
  const cur = (k) => {
    if (v.optional && v.optional[k]) return v.optional[k].value;
    return k.split(".").reduce((o, p) => (o == null ? o : o[p]), v.settings);
  };
  const show = (k, type) => { const x = cur(k); return x == null ? "" : type === "list" && Array.isArray(x) ? x.join(", ") : String(x); };
  box.innerHTML = `
    <p class="small muted">TotonouMovie の設定です（保存先：${esc(v.settingsFile || "")}）。Claude Code で「設定を変えて」と頼んだときと同じものです。</p>
    ${SET_FIELDS.map(([k, label, type, hint]) => `<div class="row"><label>${esc(label)}</label><input type="${type === "number" ? "number" : "text"}" class="grow setIn" data-k="${k}" data-type="${type}" data-orig="${esc(show(k, type))}" value="${esc(show(k, type))}"><span class="small muted">${esc(hint)}</span></div>`).join("")}
    <div class="btnrow"><button class="primary" id="setSave">変えたところを保存</button></div>
    <h3>言葉で頼む</h3>
    <textarea id="setAI" rows="2" placeholder="例：縦動画の美肌を40にしたい／章カードの効果音をなしにしたい"></textarea>
    <div class="btnrow"><button id="setAIGo">AI に頼む</button></div>`;
  $("#setSave").onclick = async () => {
    const changed = $$(".setIn").filter((i) => i.value !== i.dataset.orig);
    if (!changed.length) return toast("変わったところがありません");
    for (const i of changed) {
      let val = i.value.trim();
      if (i.dataset.type === "list") val = val ? val.split(/[,、]/).map((s) => s.trim()).filter(Boolean) : "";
      else if (i.dataset.type === "number" && val !== "") val = Number(val);
      await minePost({ op: "setting", key: i.dataset.k, value: val });
    }
    toast("設定を保存しました");
    mineSetTab(box);
  };
  $("#setAIGo").onclick = () => { const t = $("#setAI").value.trim(); if (t) mineAskAI(t); };
}

// ---------- 効果音 ----------
function mineSeTab(box) {
  const s = MINE.data.se;
  box.innerHTML = `
    <p class="small muted">同梱の効果音と同じファイル名の mp3 を「自分の効果音」フォルダに置くと、そちらが優先されます（効果音ラボなどで手に入れた音）。</p>
    <div class="btnrow"><button id="seOpen">自分の効果音のフォルダを開く</button></div>
    <div class="small">${s.bundled.map((f) => `<span class="pill ${s.mine.includes(f) ? "on" : ""}">${s.mine.includes(f) ? "✓ 自分の音 " : ""}${esc(f)}</span>`).join(" ")}</div>
    ${s.mine.filter((f) => !s.bundled.includes(f)).length ? `<p class="small warn">同梱に無い名前のファイル（使われません）：${esc(s.mine.filter((f) => !s.bundled.includes(f)).join("、"))}</p>` : ""}`;
  $("#seOpen").onclick = () => minePost({ op: "reveal", what: "se" });
}

// ---------- 拠点・引き継ぎ ----------
function mineBaseTab(box) {
  const d = MINE.data;
  const sc = d.pluginScope;
  box.innerHTML = `
    <h3>拠点</h3>
    <p class="small">このフォルダに全部まとまっています：<code>${esc(d.base)}</code> <button class="small" id="bsOpen">開く</button></p>
    <p class="small muted">動画は projects、自分好みは my、自作スキルは .claude/skills の中です。フォルダごと別の場所（Dropbox など）へ移しても、そのまま使えます。Claude Code だけで編集するときも、このフォルダで <code>claude</code> を起動すれば同じ好みとスキルが使えます。</p>
    <h3>17スキルを読み込む範囲</h3>
    ${!sc.key ? `<p class="warn small">TotonouMovie プラグインが見つかりません。</p>` : `
    <p class="small">いま：${sc.global ? "<b>すべての作業</b>で読み込まれています（動画と関係ない作業でも、スキルの説明が毎回読み込まれます）" : "<b>この拠点でだけ</b>読み込まれます"}</p>
    <div class="btnrow">${sc.global ? `<button class="primary" id="scLocal">この拠点でだけ使う（おすすめ）</button>` : `<button id="scGlobal">すべての作業で使う（前の状態に戻す）</button>`}</div>
    <p class="small muted">変えると ~/.claude/settings.json を書き換えます（元の控えを settings.json.totonoumovie.bak に残します）。totonoumovie から AI を動かすときは、どちらでも必ず使えます。</p>`}
    <h3>前の作業フォルダの動画を引き継ぐ</h3>
    ${d.legacy.length ? `<p class="small muted">前の版（Claude Code だけ）で作った動画です。拠点に移すと、一覧に出て編集できます。移さなくても「マイスタイル」から見た目だけ取り出せます。</p>
      <div>${d.legacy.map((p) => `<label class="chk" style="display:flex;margin-bottom:4px"><input type="checkbox" class="lgP" value="${esc(p.path)}" checked> ${esc(p.title)} <span class="muted small">${esc(p.path)}</span></label>`).join("")}</div>
      <div class="btnrow"><button class="primary" id="lgMove">選んだ動画を拠点に移す</button></div>`
      : `<p class="small muted">前の作業フォルダ（${esc(d.legacyDirs.join("、") || "なし")}）に引き継ぐ動画はありません。設定・マイスタイル・表記辞書・自分の効果音は、最初の起動で自動で引き継いでいます。</p>`}`;
  $("#bsOpen").onclick = () => minePost({ op: "reveal", what: "base" });
  const set = async (g) => { await minePost({ op: "plugin_scope", global: g }, g ? "すべての作業で使うようにしました" : "この拠点でだけ使うようにしました。開いている Claude Code は起動し直すと反映されます"); mineReload(); };
  if ($("#scLocal")) $("#scLocal").onclick = () => set(false);
  if ($("#scGlobal")) $("#scGlobal").onclick = () => set(true);
  if ($("#lgMove")) $("#lgMove").onclick = async () => {
    const paths = $$(".lgP").filter((c) => c.checked).map((c) => c.value);
    if (!paths.length) return;
    if (!(await askConfirm(`${paths.length} 本の動画を拠点に移します（元の場所からは無くなります）。よろしいですか？`))) return;
    const j = await minePost({ op: "legacy_move", paths }, "拠点に移しました");
    toast(`${j.moved.length} 本を移しました`);
    mineReload();
    if (!S.P && window.renderHome) window.renderHome();
  };
}

// ---------- 小さな入力（ブラウザの確認ダイアログは使わない） ----------
function askConfirm(msg) { return askInline(msg, null); }
function askText(msg, val) { return askInline(msg, val ?? ""); }
function askInline(msg, val) {
  return new Promise((resolve) => {
    const d = document.createElement("div");
    d.className = "mine-ask";
    d.innerHTML = `<div class="mine-ask-box"><div>${esc(msg)}</div>${val !== null ? `<input type="text" class="grow" value="${esc(val)}" style="width:100%;margin-top:8px">` : ""}
      <div class="btnrow"><button class="primary" data-ok>OK</button><button data-no>やめる</button></div></div>`;
    document.body.appendChild(d);
    const inp = d.querySelector("input");
    if (inp) inp.focus();
    const done = (ok) => { d.remove(); resolve(ok ? (inp ? inp.value.trim() : true) : (inp ? null : false)); };
    d.querySelector("[data-ok]").onclick = () => done(true);
    d.querySelector("[data-no]").onclick = () => done(false);
  });
}

// ======================================================================
// 「AIで作る」「AI に頼む」で使う：マイスタイルとスキルを選ぶ欄
// ======================================================================
async function fillPicker(sel, opts = {}) {
  const box = $(sel);
  if (!box) return;
  let d;
  try { d = await loadMine(); } catch (e) { box.innerHTML = ""; return; }
  const sk = d.skills;
  box.innerHTML = `
    ${opts.style ? `<h3>マイスタイル <span class="muted small">（${d.styles.length ? "保存した見た目を使う" : "まだありません。完成の確認のあとに保存できます"}）</span></h3>
      ${d.styles.length ? `<div class="row"><select class="grow pkStyle">
        <option value="__auto">AI に任せる（最初に「前回と同じで」と聞かれる）</option>
        ${d.styles.map((s) => `<option value="${esc(s.name)}">${esc(s.name)}（${esc(s.modeLabel)}）</option>`).join("")}
        <option value="">使わない（新しく決める）</option></select></div>` : ""}` : ""}
    <details class="pkSkills"><summary class="small">使うスキルを選ぶ（任意）</summary>
      ${sk.mine.length ? `<div class="small muted" style="margin-top:6px">自作スキル</div><div>${sk.mine.map((k) => `<label class="chk" style="margin-right:10px" title="${esc(k.description)}"><input type="checkbox" class="pkSkill" value="${esc(k.id)}"> ${esc(k.name)}</label>`).join("")}</div>` : `<div class="small muted" style="margin-top:6px">自作スキルはまだありません（🌱 自分好み → 🧩 スキル で作れます）</div>`}
      <div class="small muted" style="margin-top:6px">TotonouMovie のスキル（ふだんは選ばなくても、AI が必要なものを使います）</div>
      <div>${sk.plugin.map((k) => `<label class="chk" style="margin-right:10px" title="${esc(k.description)}"><input type="checkbox" class="pkSkill" value="${esc(k.id)}"> ${esc(k.name)}</label>`).join("")}</div>
    </details>`;
}
function pickerValue(sel) {
  const box = $(sel);
  if (!box) return {};
  const st = box.querySelector(".pkStyle");
  const out = { skills: $$(".pkSkill", box).filter((c) => c.checked).map((c) => c.value) };
  if (st && st.value !== "__auto") out.style = st.value;
  return out;
}
