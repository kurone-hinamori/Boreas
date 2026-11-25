import { fetch } from "@tauri-apps/plugin-http";
import type { Settings } from "../types";

type Conn = Pick<Settings, "ollamaUrl" | "model">;

const base = (s: Pick<Settings, "ollamaUrl">) => s.ollamaUrl.trim().replace(/\/+$/, "");

/** Ollama は Origin ヘッダーを検査するので、Ollama 自身のオリジンを名乗る(OLLAMA_ORIGINS の設定なしで接続できる) */
function originHeader(s: Pick<Settings, "ollamaUrl">): Record<string, string> {
  try {
    return { Origin: new URL(base(s)).origin };
  } catch {
    return {};
  }
}

/**
 * 読み込んでいるモデルを GPU から外す(外し終わるまで最大15秒待つ)。
 * ComfyUI と同じ GPU に Ollama のモデルが載ったまま画像を作ると、ComfyUI が GPU のエラーで止まることがあった。
 */
export async function unloadModel(s: Conn): Promise<void> {
  const headers = { "Content-Type": "application/json", ...originHeader(s) };
  try {
    const ps = await fetch(`${base(s)}/api/ps`, { headers: originHeader(s) });
    const loaded = ((await ps.json()) as { models?: { name: string }[] }).models ?? [];
    if (!loaded.length) return;
    for (const m of loaded) await fetch(`${base(s)}/api/generate`, { method: "POST", headers, body: JSON.stringify({ model: m.name, keep_alive: 0 }) });
    for (let i = 0; i < 30; i++) {
      const r = await fetch(`${base(s)}/api/ps`, { headers: originHeader(s) });
      if (!((await r.json()) as { models?: unknown[] }).models?.length) return;
      await new Promise((ok) => setTimeout(ok, 500));
    }
  } catch {
    // Ollama が動いていなければ、外すものもない
  }
}

const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\S]*<\/think>/, "");

/** Ollama の /api/chat を1回呼び、答えの全文を返す */
async function chat(s: Conn, system: string, user: string, format?: Record<string, unknown>): Promise<string> {
  if (!s.model) throw new Error("Ollama のモデルが選ばれていません。設定でモデルを選んでください。");
  const res = await fetch(`${base(s)}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...originHeader(s) },
    body: JSON.stringify({
      model: s.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      stream: false,
      think: false,
      format,
      options: { temperature: 0.2, num_ctx: 8192 },
    }),
  });
  if (!res.ok) throw new Error(`Ollama エラー (HTTP ${res.status}) ${await res.text().catch(() => "")}`.trim());
  const data = (await res.json()) as { message?: { content?: string }; error?: string };
  if (data.error) throw new Error(data.error);
  return stripThinking(data.message?.content ?? "").trim();
}

const SYSTEM = `You translate short Japanese notes for an anime illustration into English for an image generation prompt.
Translate each field faithfully and concisely, as comma-separated descriptive phrases. Do not add anything that is not in the Japanese.
Return an empty string for an empty field.`;

/** 場面の説明(日本語)を、清書のプロンプトの英語にする。キーはそのまま返す */
export async function translateFields<K extends string>(s: Conn, fields: Record<K, string>): Promise<Record<K, string>> {
  const keys = Object.keys(fields) as K[];
  const schema = { type: "object", properties: Object.fromEntries(keys.map((k) => [k, { type: "string" }])), required: keys };
  const text = await chat(s, SYSTEM, JSON.stringify(fields, null, 2), schema);
  const start = text.indexOf("{");
  const parsed = JSON.parse(start >= 0 ? text.slice(start, text.lastIndexOf("}") + 1) : text) as Partial<Record<K, unknown>>;
  return Object.fromEntries(keys.map((k) => [k, typeof parsed[k] === "string" ? (parsed[k] as string).trim() : ""])) as Record<K, string>;
}
