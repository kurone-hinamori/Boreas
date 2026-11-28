import type { Settings } from "../types";
import { detectModels, progressText, refine } from "./comfy";
import { unloadModel } from "./ollama";
import { type Design, floorBounds, FURNITURE_KINDS, type Furniture, OPENING_KINDS, type Place } from "./place";
import { savePlaceFile } from "./storage";

// 部屋・家具のデザイン(設計書 5.4)。日本語の説明(英語にしたもの)から、ComfyUI(MiniMax-H3-Image)で絵を作る。キャラクターシートの家具版

const clean = (s: string | undefined) => (s ?? "").trim().replace(/[\s.。]+$/, "");

/** 画風の欄が空のときの画風。文章だけで描くので、「anime」の一語では実写寄りになりやすい。はっきり手描きの2Dと書き、写真にしないと言う */
export const DEFAULT_STYLE_EN =
  "2D hand-drawn anime illustration in the style of a Japanese light novel, cel shading with clean line art and simple flat colors. Not a photograph, not photorealistic, not a 3D render";

/** デザインのプロンプトの先頭に入れる画風の文。場所の「画風」(英語)があればそれ、無ければ既定の画風 */
export function styleLine(place: Place): string {
  return `Art style: ${clean(place.style?.en) || DEFAULT_STYLE_EN}.`;
}

/** 部屋のデザイン(人物のいない部屋の絵)のプロンプト。清書で背景の参照にする */
export function roomDesignPrompt(place: Place): string {
  const [x0, z0, x1, z1] = floorBounds(place.floor);
  const count = (k: "door" | "window") => place.openings.filter((o) => o.kind === k).length;
  const openings = (["window", "door"] as const)
    .filter((k) => count(k))
    .map((k) => `${count(k)} ${OPENING_KINDS[k].en}${count(k) > 1 ? "s" : ""}`)
    .join(" and ");
  const furniture = place.furniture.map((f) => clean(f.name.en) || `a ${FURNITURE_KINDS[f.kind].en}`);
  return [
    styleLine(place),
    `Background art of an empty room with no people, for an anime-style light novel illustration${clean(place.description.en) ? `: ${clean(place.description.en)}` : ""}.`,
    `The room is about ${Math.round(x1 - x0)} cm wide, ${Math.round(z1 - z0)} cm deep and ${place.ceilingCm} cm high${openings ? `, with ${openings}` : ""}.`,
    furniture.length ? `Furniture in the room: ${furniture.join("; ")}.` : "",
    "A wide view of the whole room from a corner at eye level, soft lighting, drawn in the art style above. No people, no text, no logo.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 家具のデザインのプロンプト。家具1つだけを、白い背景に描く */
export function furnitureDesignPrompt(f: Furniture, place: Place): string {
  const kind = FURNITURE_KINDS[f.kind].en;
  const what = clean(f.name.en) || `a ${kind}`;
  return [
    styleLine(place),
    `A design reference picture of a single piece of furniture for an anime-style light novel illustration: ${what} (a ${kind}, about ${Math.round(f.widthCm)} cm wide, ${Math.round(f.depthCm)} cm deep and ${Math.round(f.heightCm)} cm tall).`,
    // 部屋の説明(壁・床・ポスターなど)を入れると、画風の文と合わせて壁や床まで描かれた(2026-11-28)。家具の説明だけで描く
    "Show the whole piece at a three-quarter front view, isolated on a plain white background, drawn in the art style above.",
    "Only this one piece of furniture. No walls, no floor, no posters, no people, no text, no logo.",
  ].join("\n");
}

/** デザインの絵の大きさ。部屋は横長、家具は正方形(清書では約4MPで描いてから、この大きさにする) */
export const DESIGN_SIZE = { room: [1600, 1120], furniture: [1024, 1024] } as const;

/** デザインの絵を作って、場所のフォルダーの designs/<id>.png に保存する */
export async function makeDesign(
  settings: Settings,
  placeId: string,
  prompt: string,
  size: readonly [number, number],
  signal: AbortSignal,
  onStatus: (text: string) => void,
): Promise<Design> {
  onStatus("ComfyUI のモデルを確かめています");
  const models = await detectModels(settings);
  onStatus("Ollama のモデルを GPU から外しています");
  await unloadModel(settings);
  const seed = Math.floor(Math.random() * 2 ** 32);
  const r = await refine(settings, models, { prompt, width: size[0], height: size[1], seed, images: [] }, signal, (p) => onStatus(progressText(p).replace("清書しています", "デザインを作っています")));
  const file = `designs/${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}.png`;
  await savePlaceFile(placeId, file, r.png);
  return { file, prompt, seed, createdAt: new Date().toISOString() };
}
