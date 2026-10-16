// ヘッドレス Chrome で画面写真を撮る（縁や影の入らない、きれいな画面写真用）
// 使い方: node cdpshot.mjs <撮影リスト.json>
//   リスト: {"url": "...", "width":1920, "height":1080, "mask": [["置き換え前","置き換え後"],...],
//           "shots": [{"name":"app-home", "js":"...", "wait":1500}, ...], "out": "出力フォルダ"}
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const spec = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = +process.env.CDP_PORT || 9400 + Math.floor(Math.random() * 500);   // 同時に撮っても取り合わないよう毎回ずらす
const prof = fs.mkdtempSync("/tmp/cdp-");
const chrome = spawn(CHROME, [`--remote-debugging-port=${port}`, "--headless=new", `--user-data-dir=${prof}`,
  `--window-size=${spec.width || 1920},${spec.height || 1080}`, "--hide-scrollbars", "--force-device-scale-factor=1",
  "--autoplay-policy=no-user-gesture-required", "--mute-audio", "about:blank"], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl = null;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const page = list.find((t) => t.type === "page");
    if (page) wsUrl = page.webSocketDebuggerUrl;
  } catch (e) { /* まだ起動中 */ }
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const waits = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waits.has(d.id)) { waits.get(d.id)(d); waits.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; waits.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: spec.width || 1920, height: spec.height || 1080, deviceScaleFactor: spec.scale || 1, mobile: false });
await send("Page.navigate", { url: spec.url });
await sleep(spec.firstWait || 3500);
const maskJs = `(()=>{const P=${JSON.stringify(spec.mask || [])};const f=s=>{for(const [a,b] of P)s=s.split(a).join(b);return s};
const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const v=f(n.nodeValue);if(v!==n.nodeValue)n.nodeValue=v}
document.querySelectorAll('input,textarea').forEach(e=>{const v=f(e.value);if(v!==e.value)e.value=v})})()`;
fs.mkdirSync(spec.out, { recursive: true });
for (const s of spec.shots) {
  if (s.js) {
    const r = await send("Runtime.evaluate", { expression: `(async()=>{${s.js}})()`, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) console.error(s.name, "JS エラー:", r.result.exceptionDetails.exception?.description);
  }
  await sleep(s.wait ?? 1200);
  await send("Runtime.evaluate", { expression: maskJs });
  if (s.measure) {
    // 要素の位置を画面に対する割合で記録する（動画のカーソルと光る枠に使う）
    const ex = `(()=>{const o={};const M=${JSON.stringify(s.measure)};for(const k in M){const e=document.querySelector(M[k]);if(!e){o[k]=null;continue}const r=e.getBoundingClientRect();o[k]=[+(r.left/innerWidth).toFixed(4),+(r.top/innerHeight).toFixed(4),+(r.width/innerWidth).toFixed(4),+(r.height/innerHeight).toFixed(4)]}return JSON.stringify(o)})()`;
    const r = await send("Runtime.evaluate", { expression: ex, returnByValue: true });
    fs.writeFileSync(path.join(spec.out, s.name + ".rects.json"), r.result.result.value);
  }
  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(spec.out, s.name + ".png"), Buffer.from(shot.result.data, "base64"));
  console.log(s.name);
}
ws.close();
chrome.kill();
