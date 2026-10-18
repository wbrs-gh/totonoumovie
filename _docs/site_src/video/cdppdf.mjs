// ヘッドレス Chrome でページを PDF にする。使い方: node cdppdf.mjs <URL> <出力.pdf>
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const [url, out] = process.argv.slice(2);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--remote-debugging-port=9334", "--headless=new", `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) { await sleep(200); try { wsUrl = (await (await fetch("http://127.0.0.1:9334/json")).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch (e) {} }
const ws = new WebSocket(wsUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const w = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && w.has(d.id)) { w.get(d.id)(d); w.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; w.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.enable"); await send("Page.navigate", { url }); await sleep(5000);
const r = await send("Page.printToPDF", { printBackground: true, preferCSSPageSize: false, paperWidth: 8.27, paperHeight: 11.69, marginTop: 0.5, marginBottom: 0.5, marginLeft: 0.5, marginRight: 0.5, displayHeaderFooter: false });
if (r.error) { console.error("PDF エラー:", JSON.stringify(r.error)); } else { fs.writeFileSync(out, Buffer.from(r.result.data, "base64")); console.log(out); }
ws.close(); chrome.kill();
