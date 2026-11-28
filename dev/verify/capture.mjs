// dev/places.html を headless Chrome で開き、window.out を out.json に、ページのスクリーンショットを page.png に保存する
// usage: node dev/verify/capture.mjs <url> <outdir> [inputJson]
// inputJson は { "characters": { "<id>": <Euros の character.json> } }(dev/places.html の window.__input)
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [url, outdir, inputFile] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = path.join(outdir, "chrome-profile");
const port = 9333;
const proc = spawn(chrome, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1400,2400", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const page = list.find((t) => t.type === "page");
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      break;
    }
  } catch {}
  await sleep(200);
}
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
  if (m.method === "Runtime.consoleAPICalled") console.log("[page]", m.params.args.map((a) => a.value ?? a.description).join(" "));
  if (m.method === "Runtime.exceptionThrown") console.log("[page error]", JSON.stringify(m.params.exceptionDetails).slice(0, 2000));
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
await send("Runtime.enable");
await send("Page.enable");
if (inputFile) await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__input = ${fs.readFileSync(inputFile, "utf8")};` });
await send("Page.navigate", { url });
let done = false;
for (let i = 0; i < 600 && !done; i++) {
  await sleep(500);
  const r = await send("Runtime.evaluate", { expression: "window.done === true", returnByValue: true });
  done = r.result?.result?.value === true;
}
if (!done) console.log("timed out");
const r = await send("Runtime.evaluate", { expression: "JSON.stringify(window.out ?? null)", returnByValue: true });
fs.writeFileSync(path.join(outdir, "out.json"), r.result.result.value ?? "null");
const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
fs.writeFileSync(path.join(outdir, "page.png"), Buffer.from(shot.result.data, "base64"));
const logText = await send("Runtime.evaluate", { expression: "document.getElementById('log')?.textContent ?? ''", returnByValue: true });
fs.writeFileSync(path.join(outdir, "log.txt"), logText.result.result.value);
ws.close();
proc.kill();
console.log("ok");
process.exit(0);
