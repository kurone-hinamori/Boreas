// out.json(dev/places.html?out=1)から、部屋・家具のデザインを作り、2つの場面を清書する(アプリと同じワークフロー)
// usage: node dev/verify/refine.mjs <outdir> [seedsPerScene]
// できあがった画像(designs/*.png・<場面>_result_<n>.png)があれば飛ばすので、途中で止まっても同じコマンドで続きから作る
import fs from "node:fs";
import path from "node:path";

const [dir, seedsArg] = process.argv.slice(2);
const seeds = Number(seedsArg ?? 2);
const out = JSON.parse(fs.readFileSync(path.join(dir, "out.json"), "utf8"));
const BASE = "http://127.0.0.1:8188";
const H = { "Content-Type": "application/json", Origin: BASE };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const euros = process.env.EUROS_LIBRARY ?? path.join(process.env.APPDATA ?? "", "Euros", "library");
const log = (t) => {
  console.log(`${new Date().toISOString()} ${t}`);
  fs.appendFileSync(path.join(dir, "run.log"), `${new Date().toISOString()} ${t}\n`);
};

async function models() {
  const pick = async (node, input, prefix) => {
    const info = await (await fetch(`${BASE}/object_info/${node}`, { headers: H })).json();
    const spec = info[node].input.required[input];
    const list = Array.isArray(spec[0]) ? spec[0] : spec[1].options;
    return list.find((m) => m.startsWith(prefix));
  };
  return { UNET: await pick("UNETLoader", "unet_name", "minimax_h3_image"), CLIP: await pick("CLIPLoader", "clip_name", "qwen3vl_32b_minimax_h3"), VAE: await pick("VAELoader", "vae_name", "minimax_h3_image_vae") };
}

async function upload(name, bytes) {
  const form = new FormData();
  form.append("image", new Blob([bytes], { type: "image/png" }), name);
  form.append("subfolder", "boreas");
  form.append("overwrite", "true");
  const res = await fetch(`${BASE}/upload/image`, { method: "POST", headers: { Origin: BASE }, body: form });
  const j = await res.json();
  return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
}

function fill(workflow, m, seed, images) {
  const g = JSON.parse(JSON.stringify(workflow));
  g.unet.inputs.unet_name = m.UNET;
  g.clip.inputs.clip_name = m.CLIP;
  g.vae.inputs.vae_name = m.VAE;
  g.sampler.inputs.seed = seed;
  for (const n of Object.values(g)) if (n.class_type === "LoadImage") n.inputs.image = images[Number(n.inputs.image.replace("IMAGE_", ""))];
  return g;
}

async function run(graph, file) {
  if (fs.existsSync(file)) return log(`skip ${file}`);
  const res = await fetch(`${BASE}/prompt`, { method: "POST", headers: H, body: JSON.stringify({ prompt: graph, client_id: "boreas-verify" }) });
  const sent = await res.json();
  if (!sent.prompt_id) throw new Error(JSON.stringify(sent));
  const id = sent.prompt_id;
  const t0 = Date.now();
  for (;;) {
    await sleep(3000);
    const h = (await (await fetch(`${BASE}/history/${id}`, { headers: H })).json())[id];
    if (!h) continue;
    if (h.status?.status_str !== "success") throw new Error(JSON.stringify(h.status).slice(0, 1000));
    const im = h.outputs.save.images[0];
    const q = new URLSearchParams({ filename: im.filename, subfolder: im.subfolder, type: im.type });
    fs.writeFileSync(file, Buffer.from(await (await fetch(`${BASE}/view?${q}`, { headers: H })).arrayBuffer()));
    log(`done ${file} (${Math.round((Date.now() - t0) / 1000)}s)`);
    return;
  }
}

const m = await models();
log(`models ${JSON.stringify(m)}`);
// Ollama のモデルを GPU から外す
try {
  const ps = await (await fetch("http://127.0.0.1:11434/api/ps")).json();
  for (const x of ps.models ?? []) await fetch("http://127.0.0.1:11434/api/generate", { method: "POST", body: JSON.stringify({ model: x.name, keep_alive: 0 }) });
} catch {}
// 前に別のモデル(MOSS など)が動いていれば外す
const hist = await (await fetch(`${BASE}/history?max_items=1`, { headers: H })).json();
const last = Object.values(hist)[0]?.prompt?.[2];
const lastUnet = last && Object.values(last).find((n) => n.class_type === "UNETLoader")?.inputs.unet_name;
if (lastUnet && lastUnet !== m.UNET) {
  log(`free ${lastUnet}`);
  await fetch(`${BASE}/free`, { method: "POST", headers: H, body: JSON.stringify({ unload_models: true, free_memory: true }) });
  await sleep(3000);
}

fs.mkdirSync(path.join(dir, "designs"), { recursive: true });
fs.writeFileSync(path.join(dir, "designs", "prompts.json"), JSON.stringify(out.designs.map((d) => ({ file: d.file, prompt: d.prompt })), null, 2));
// 清書で使うデザインだけを作る
const needed = new Set(Object.values(out.scenes).flatMap((s) => s.refs.filter((r) => r.kind !== "character").map((r) => r.image)));
for (const [i, d] of out.designs.entries()) {
  if (!needed.has(d.file)) continue;
  await run(fill(d.workflow, m, 1000 + i, []), path.join(dir, d.file));
}
for (const [key, s] of Object.entries(out.scenes)) {
  fs.writeFileSync(path.join(dir, `${key}_sketch.png`), Buffer.from(s.sketch, "base64"));
  fs.writeFileSync(path.join(dir, `${key}_prompt.txt`), s.prompt);
  const images = [await upload(`verify_${key}_sketch.png`, fs.readFileSync(path.join(dir, `${key}_sketch.png`)))];
  for (const r of s.refs) {
    const file = r.kind === "character" ? path.join(euros, "characters", r.characterId, r.image) : path.join(dir, r.image);
    images.push(await upload(`verify_${path.basename(file)}`, fs.readFileSync(file)));
  }
  log(`${key}: images ${JSON.stringify(images)}`);
  for (let k = 0; k < seeds; k++) await run(fill(s.workflow, m, 20261128 + k, images), path.join(dir, `${key}_result_${k + 1}.png`));
}
log("all done");
