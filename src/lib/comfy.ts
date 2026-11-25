import { fetch } from "@tauri-apps/plugin-http";
import type { Settings } from "../types";

// ComfyUI で清書する(MiniMax-H3-Image)。Euros の src/lib/comfy と同じ設定・同じ待ち方にしている。

type Url = Pick<Settings, "comfyUrl">;

/** ComfyUI の API 形式のワークフロー */
export type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
type Link = [string, number];

const base = (s: Url) => s.comfyUrl.trim().replace(/\/+$/, "");

/** ComfyUI は Origin ヘッダーを検査するので、ComfyUI 自身のオリジンを名乗る */
function headers(s: Url): Record<string, string> {
  try {
    return { "Content-Type": "application/json", Origin: new URL(base(s)).origin };
  } catch {
    return { "Content-Type": "application/json" };
  }
}

async function getJson<T>(s: Url, path: string): Promise<T> {
  const res = await fetch(`${base(s)}${path}`, { headers: headers(s) });
  if (!res.ok) throw new Error(`ComfyUI エラー ${res.status}`);
  return (await res.json()) as T;
}

const post = (s: Url, path: string, body: unknown) => fetch(`${base(s)}${path}`, { method: "POST", headers: headers(s), body: JSON.stringify(body) });

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

// ---------------------------------------------------------------- モデル

/** MiniMax-H3-Image のファイル(名前の先頭で探す) */
const FILES = {
  unet: { node: "UNETLoader", input: "unet_name", prefix: "minimax_h3_image", need: "minimax_h3_image_pruned_int8_convrot.safetensors(models/diffusion_models)" },
  clip: { node: "CLIPLoader", input: "clip_name", prefix: "qwen3vl_32b_minimax_h3", need: "qwen3vl_32b_minimax_h3_int8_convrot.safetensors(models/text_encoders)" },
  vae: { node: "VAELoader", input: "vae_name", prefix: "minimax_h3_image_vae", need: "minimax_h3_image_vae_fp16.safetensors(models/vae)" },
} as const;

export type ComfyModels = Record<keyof typeof FILES, string>;

async function modelsOf(s: Url, node: string, input: string): Promise<string[]> {
  const info = await getJson<Record<string, { input: { required: Record<string, unknown[]> } }>>(s, `/object_info/${node}`);
  const spec = info[node]?.input.required[input] ?? [];
  if (Array.isArray(spec[0])) return spec[0] as string[];
  return ((spec[1] as { options?: string[] } | undefined)?.options ?? []) as string[];
}

/** ComfyUI にある MiniMax-H3-Image のファイルを探す。足りなければ、足りないファイルを示すエラーにする */
export async function detectModels(s: Url): Promise<ComfyModels> {
  const keys = Object.keys(FILES) as (keyof typeof FILES)[];
  const found = await Promise.all(keys.map(async (k) => (await modelsOf(s, FILES[k].node, FILES[k].input)).find((m) => m.startsWith(FILES[k].prefix))));
  const missing = keys.filter((_, i) => !found[i]).map((k) => FILES[k].need);
  if (missing.length) throw new Error(`MiniMax-H3-Image のモデルが見つかりません:${missing.join("、")}`);
  return Object.fromEntries(keys.map((k, i) => [k, found[i]!])) as ComfyModels;
}

// ---------------------------------------------------------------- ワークフロー

export interface RefineRequest {
  prompt: string;
  /** 仕上がりの大きさ */
  width: number;
  height: number;
  seed: number;
  /** Picture 1, 2, … の順。ComfyUI に送ったあとの名前 */
  images: string[];
}

const round = (v: number, step: number) => Math.round(v / step) * step;

/** 4MP より小さいと崩れる(公式の注意)ので、仕上がりの縦横比のまま約4MPで描く */
export function drawSize(w: number, h: number): [number, number] {
  const k = Math.sqrt(4_194_304 / (w * h));
  return [Math.max(1024, round(w * k, 32)), Math.max(1024, round(h * k, 32))];
}

const SAVE_NODE = "save";

/** MiniMax-H3-Image の公式テンプレートと同じ設定(6ステップ、CFG 1、ネガティブなし) */
export function refineWorkflow(m: ComfyModels, r: RefineRequest): Graph {
  const [w, h] = drawSize(r.width, r.height);
  const g: Graph = {
    unet: { class_type: "UNETLoader", inputs: { unet_name: m.unet, weight_dtype: "default" } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: m.clip, type: "minimax", device: "default" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: m.vae } },
  };
  const images: Record<string, Link> = {};
  r.images.forEach((name, i) => {
    // 参照する画像は約1MPにそろえる
    g[`ref${i}`] = { class_type: "LoadImage", inputs: { image: name } };
    g[`ref${i}Scaled`] = { class_type: "ImageScaleToTotalPixels", inputs: { image: [`ref${i}`, 0], upscale_method: "lanczos", megapixels: 1, resolution_steps: 32 } };
    images[`images.image_${i + 1}`] = [`ref${i}Scaled`, 0];
  });
  g.positive = { class_type: "MiniMaxH3ImageConditioning", inputs: { clip: ["clip", 0], vae: ["vae", 0], prompt: r.prompt, width: w, height: h, ...images } };
  g.negative = { class_type: "ConditioningZeroOut", inputs: { conditioning: ["positive", 0] } };
  g.sampler = {
    class_type: "KSampler",
    inputs: { model: ["unet", 0], seed: r.seed, steps: 6, cfg: 1, sampler_name: "euler", scheduler: "simple", positive: ["positive", 0], negative: ["negative", 0], latent_image: ["positive", 1], denoise: 1 },
  };
  g.decode = { class_type: "VAEDecode", inputs: { samples: ["sampler", 0], vae: ["vae", 0] } };
  let image: Link = ["decode", 0];
  if (w !== r.width || h !== r.height) {
    // 大きな画像を lanczos で縮めると GPU のメモリを多く使った。縮めるときは area にする
    const up = w < r.width || h < r.height;
    g.scale = { class_type: "ImageScale", inputs: { image, upscale_method: up ? "lanczos" : "area", width: r.width, height: r.height, crop: "center" } };
    image = ["scale", 0];
  }
  // ComfyUI の output フォルダーを増やさないよう、一時ファイルとして受け取る
  g[SAVE_NODE] = { class_type: "PreviewImage", inputs: { images: image } };
  return g;
}

// ---------------------------------------------------------------- 生成

/** 1枚の処理がこれより長ければ、止まったとみなす */
const STALL_MS = 25 * 60_000;
/** ComfyUI に送られてからこれより長く処理中なら、止まったとみなす */
const STALL_QUEUED_MS = 60 * 60_000;

export type Progress =
  | { phase: "free" }
  | { phase: "queued"; ahead: number; seconds: number }
  | { phase: "running"; seconds: number }
  | { phase: "download" };

export function progressText(p: Progress): string {
  switch (p.phase) {
    case "free":
      return "前のモデルを ComfyUI から外しています";
    case "queued":
      return `順番を待っています(前に ${p.ahead} 件 · ${p.seconds}秒)`;
    case "running":
      return `清書しています(${p.seconds}秒。1枚に6分ほどかかります)`;
    case "download":
      return "画像を受け取っています";
  }
}

interface HistoryEntry {
  status?: { status_str?: string; messages?: [string, { exception_message?: string }][] };
  outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>;
}

type Queue = { queue_running: unknown[][]; queue_pending: unknown[][] };

/** 画像を ComfyUI の input フォルダーの boreas に送る(同じ名前なら上書きする) */
export async function uploadImage(s: Url, name: string, bytes: Uint8Array): Promise<string> {
  const form = new FormData();
  const type = /\.jpe?g$/i.test(name) ? "image/jpeg" : /\.webp$/i.test(name) ? "image/webp" : "image/png";
  form.append("image", new Blob([bytes as BlobPart], { type }), name);
  form.append("subfolder", "boreas");
  form.append("overwrite", "true");
  const { "Content-Type": _, ...rest } = headers(s);
  const res = await fetch(`${base(s)}/upload/image`, { method: "POST", headers: rest, body: form });
  if (!res.ok) throw new Error(`画像を ComfyUI に送れませんでした(${res.status})`);
  const out = (await res.json()) as { name: string; subfolder?: string };
  return out.subfolder ? `${out.subfolder}/${out.name}` : out.name;
}

/**
 * ComfyUI に別のモデルが載っていれば外す。
 * 別のモデル(MOSS-Image など)を載せたまま MiniMax-H3-Image を動かすと、GPU のメモリを使い切って PC ごと固まったことがあった(Euros)。
 */
async function freeOtherModels(s: Url, m: ComfyModels, onProgress: (p: Progress) => void): Promise<void> {
  const history = await getJson<Record<string, { prompt?: unknown[] }>>(s, "/history?max_items=1").catch(() => ({}) as Record<string, { prompt?: unknown[] }>);
  const last = Object.values(history)[0]?.prompt?.[2] as Graph | undefined;
  if (!last) return;
  const used = (type: string, key: string) => Object.values(last).find((n) => n.class_type === type)?.inputs[key];
  const unet = used("UNETLoader", "unet_name");
  const clip = used("CLIPLoader", "clip_name");
  if ((unet === undefined || unet === m.unet) && (clip === undefined || clip === m.clip)) return;
  onProgress({ phase: "free" });
  const res = await post(s, "/free", { unload_models: true, free_memory: true });
  if (res.ok) await sleep(3000);
}

export interface RefineResult {
  png: Uint8Array;
  /** ComfyUI に送ったワークフロー(同じ絵を作り直せるよう、場面に残す) */
  workflow: Graph;
}

/** 1枚清書して PNG で受け取る。中断すると ComfyUI 側の処理も止める */
export async function refine(s: Url, models: ComfyModels, req: RefineRequest, signal: AbortSignal, onProgress: (p: Progress) => void): Promise<RefineResult> {
  await freeOtherModels(s, models, onProgress);
  const workflow = refineWorkflow(models, req);
  const res = await post(s, "/prompt", { prompt: workflow, client_id: "boreas" });
  const sent = (await res.json().catch(() => ({}))) as { prompt_id?: string; error?: { message?: string } };
  if (!res.ok || !sent.prompt_id) throw new Error(`ComfyUI が受け付けませんでした:${sent.error?.message ?? res.status}`);
  const id = sent.prompt_id;
  const started = Date.now();
  // ComfyUI で処理中の作業と、それを最初に見た時刻(止まった作業の後ろに並ぶと、自分の番が来ないため)
  let runningId = "";
  let deadline = 0;
  let checked = 0;
  let ahead = -1;

  for (;;) {
    if (signal.aborted) {
      await post(s, "/queue", { delete: [id] }).catch(() => undefined);
      const q = await getJson<Queue>(s, "/queue").catch(() => ({ queue_running: [], queue_pending: [] }));
      if (q.queue_running.some((x) => x[1] === id)) await post(s, "/interrupt", {}).catch(() => undefined);
      throw new DOMException("中断しました", "AbortError");
    }
    const history = await getJson<Record<string, HistoryEntry>>(s, `/history/${id}`).catch((e: unknown) => {
      throw new Error(`清書の途中で ComfyUI との接続が切れました。ComfyUI が終了していないか確認してください(${e instanceof Error ? e.message : String(e)})`);
    });
    const h = history[id];
    if (h) {
      if (h.status?.status_str !== "success") {
        const e = h.status?.messages?.find(([k]) => k === "execution_error")?.[1];
        throw new Error(`清書できませんでした:${e?.exception_message?.trim() ?? "ComfyUI のログを確認してください"}`);
      }
      const im = h.outputs?.[SAVE_NODE]?.images?.[0];
      if (!im) throw new Error("ComfyUI から画像を受け取れませんでした");
      onProgress({ phase: "download" });
      const q = new URLSearchParams({ filename: im.filename, subfolder: im.subfolder, type: im.type });
      const file = await fetch(`${base(s)}/view?${q}`, { headers: headers(s) });
      if (!file.ok) throw new Error(`画像を受け取れませんでした(${file.status})`);
      return { png: new Uint8Array(await file.arrayBuffer()), workflow };
    }
    if (Date.now() - checked > 3_000) {
      checked = Date.now();
      const q = await getJson<Queue>(s, "/queue").catch(() => null);
      if (q) {
        const mine = q.queue_running.some((x) => x[1] === id);
        // 待ちの列は番号(先頭の値)の小さい順に処理される
        const myNumber = q.queue_pending.find((x) => x[1] === id)?.[0] as number | undefined;
        ahead = mine ? 0 : myNumber === undefined ? 0 : q.queue_running.length + q.queue_pending.filter((x) => (x[0] as number) < myNumber).length;
        // GPU のエラーで ComfyUI の処理が止まると、処理中のまま終わらない。長すぎたら知らせる
        const running = q.queue_running[0];
        const rid = typeof running?.[1] === "string" ? running[1] : "";
        if (rid !== runningId) {
          runningId = rid;
          const created = (running?.[3] as { create_time?: number } | undefined)?.create_time;
          deadline = rid ? Math.min(Date.now() + STALL_MS, typeof created === "number" ? created + STALL_QUEUED_MS : Infinity) : 0;
        }
      }
    }
    if (deadline && Date.now() > deadline) {
      await post(s, "/queue", { delete: [id] }).catch(() => undefined);
      throw new Error("ComfyUI の処理が長い時間進んでいません。ComfyUI のコンソールにエラーが出ていれば、ComfyUI を起動し直してから作り直してください。");
    }
    const seconds = Math.round((Date.now() - started) / 1000);
    onProgress(ahead > 0 ? { phase: "queued", ahead, seconds } : { phase: "running", seconds });
    await sleep(1000, signal);
  }
}
