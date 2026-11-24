import { fetch } from "@tauri-apps/plugin-http";

const trim = (url: string) => url.trim().replace(/\/+$/, "");

/** ComfyUI と Ollama は Origin ヘッダーを検査するので、相手自身のオリジンを名乗る */
async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { method: "GET", headers: { Origin: new URL(url).origin }, connectTimeout: 5000 });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

/** ComfyUI の版と GPU */
export async function comfyStats(comfyUrl: string): Promise<{ version: string; gpu: string }> {
  const s = await getJson<{ system?: { comfyui_version?: string }; devices?: { name: string }[] }>(`${trim(comfyUrl)}/system_stats`);
  return { version: s.system?.comfyui_version ?? "?", gpu: s.devices?.[0]?.name.replace(/^cuda:\d+\s*/, "") ?? "" };
}

/** Ollama のモデルの一覧 */
export async function ollamaModels(ollamaUrl: string): Promise<string[]> {
  const t = await getJson<{ models?: { name: string }[] }>(`${trim(ollamaUrl)}/api/tags`);
  return (t.models ?? []).map((m) => m.name).sort();
}
