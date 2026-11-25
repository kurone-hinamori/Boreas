import { type FigureId, PERSON_COLORS } from "./figures";
import { type PoseId, POSES } from "./poses";
import { DEFAULT_CAMERA, type StageCamera, type StagePerson } from "./stage";

/** scene.json の形の版。形を変えたら上げる */
export const SCENE_SCHEMA_VERSION = 1;

/** 仕上がりの枠 */
export const FRAMES = {
  cover: { label: "表紙(1600×2560)", width: 1600, height: 2560 },
  portrait: { label: "挿絵・縦(1680×2400)", width: 1680, height: 2400 },
  landscape: { label: "挿絵・横(2400×1680)", width: 2400, height: 1680 },
} as const;

export type FrameId = keyof typeof FRAMES;

/** 下絵の大きさ。清書では約1MPにそろえて渡すので、それより少し大きく撮る */
export function sketchSize(frame: FrameId): [number, number] {
  const { width, height } = FRAMES[frame];
  const k = Math.sqrt(1_300_000 / (width * height));
  return [Math.round(width * k), Math.round(height * k)];
}

/** 日本語と、清書に使う英語 */
export interface Text {
  ja: string;
  en: string;
}

export const emptyText = (): Text => ({ ja: "", en: "" });

/** 場面に置いた人物。見た目は Euros のキャラクター、形と動きは素体 */
export interface ScenePerson extends StagePerson {
  /** Euros のキャラクターの id と、使ったシートの版の id */
  characterId: string;
  revisionId: string | null;
  name: string;
  /** 動作と表情(ポーズの一覧にない細かい動き) */
  action: Text;
  expression: Text;
}

/** 清書を1回するごとに1つ増える。同じ絵を作り直せるよう、使ったものをすべて残す */
export interface Take {
  id: string;
  createdAt: string;
  frame: FrameId;
  /** 下絵(sketches/<id>.png)と清書(results/<id>.png。失敗したときはない) */
  sketch: string;
  result: string | null;
  seed: number;
  prompt: string;
  /** Picture 2 以降に渡したシート(Euros のキャラクターの id と版の id) */
  sheets: { characterId: string; revisionId: string | null }[];
  /** ComfyUI に送ったワークフロー(API 形式) */
  workflow?: unknown;
  /** 失敗したときのエラー */
  error?: string;
}

export interface Scene {
  schemaVersion: number;
  app: "Boreas";
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  frame: FrameId;
  people: ScenePerson[];
  camera: StageCamera;
  /** 背景(場所を使わないとき、背景は文章だけで決める) */
  background: Text;
  takes: Take[];
  /** 採用した清書(Take の id) */
  adopted: string | null;
}

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

export function newScene(title: string): Scene {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    app: "Boreas",
    id: newId(),
    title,
    createdAt: now,
    updatedAt: now,
    frame: "cover",
    people: [],
    camera: { ...DEFAULT_CAMERA },
    background: emptyText(),
    takes: [],
    adopted: null,
  };
}

// ---------------------------------------------------------------- Euros のキャラクター

/** Boreas が使う分だけの Euros のキャラクター(形は Euros の docs/character-format.md) */
export interface EurosCharacter {
  id: string;
  profile?: { name?: string; gender?: string };
  style?: string;
  appearance?: Partial<Record<string, Partial<Text>>>;
  sheet?: { notHuman?: boolean };
  revisions?: { id: string; image?: string }[];
  currentRevision?: string;
}

/** 採用中の版のシート("sheets/<id>.png")と版の id */
export function currentSheet(c: EurosCharacter): { revisionId: string; image: string } | null {
  const r = c.revisions?.find((x) => x.id === c.currentRevision);
  return r?.image ? { revisionId: r.id, image: r.image } : null;
}

const ja = (c: EurosCharacter, k: string) => `${c.appearance?.[k]?.ja ?? ""} ${c.appearance?.[k]?.en ?? ""}`;

/** 身長(cm)を説明から読む。書いていなければ性別から決める */
export function guessHeight(c: EurosCharacter, male: boolean): number {
  const m = ja(c, "height").match(/(1\d{2}|2[0-4]\d)(?:\.\d)?\s*(?:cm|センチ)/i);
  return m ? Number(m[1]) : male ? 170 : 155;
}

/** 素体の種類を、性別と体型の説明から決める(画面で直せる) */
export function guessFigure(c: EurosCharacter): FigureId {
  const gender = c.profile?.gender ?? "";
  const male = /男|male|boy|man/i.test(gender) && !/女|female|woman|girl/i.test(gender);
  const body = ja(c, "body");
  const build = /細|華奢|スレンダー|痩|slim|slender|thin|petite/i.test(body)
    ? "slim"
    : /がっしり|筋肉|大柄|太|ぽっちゃり|muscular|stocky|sturdy|chubby|heavy/i.test(body)
      ? "stocky"
      : "standard";
  return `${male ? "male" : "female"}_${build}` as FigureId;
}

export function isMale(f: FigureId) {
  return f.startsWith("male");
}

/** Euros のキャラクターから、場面に置く人物を作る */
export function personFrom(c: EurosCharacter, index: number): ScenePerson {
  const figure = guessFigure(c);
  return {
    characterId: c.id,
    revisionId: currentSheet(c)?.revisionId ?? null,
    name: c.profile?.name || "(名前なし)",
    figure,
    heightCm: guessHeight(c, isMale(figure)),
    x: 0,
    z: 0,
    rotation: 0,
    pose: "stand",
    headYaw: 0,
    headPitch: 0,
    color: index,
    action: emptyText(),
    expression: emptyText(),
  };
}

// ---------------------------------------------------------------- 清書のプロンプト

const LOOK_KEYS = ["hair", "eyes", "face", "skin", "body", "outfit", "accessories", "equipment"];

/** 外見の英語をつなげる(Picture 2 のシートと同じ見た目を言葉でも伝える) */
export function lookOf(c: EurosCharacter): string {
  return LOOK_KEYS.map((k) => clean(c.appearance?.[k]?.en))
    .filter(Boolean)
    .join("; ");
}

/** 文の終わりの句点を取る(つなげたときに ".;" や ".." にならないように) */
const clean = (s: string | undefined) => (s ?? "").trim().replace(/[\s.。]+$/, "");

const poseEn = (id: PoseId) => POSES.find((p) => p.id === id)?.en ?? "standing";

/**
 * 清書のプロンプト。検証で効いた形(設計書 5.7):
 * Picture 1 = 下絵は位置・ポーズ・向き・カメラだけに使い、素体の体や色は描かない。Picture 2〜 = 人物のシート(色の順)
 */
export function buildPrompt(scene: Scene, characters: Record<string, EurosCharacter>): string {
  const people = scene.people;
  const seat = people.some((p) => POSES.find((d) => d.id === p.pose)?.seat);
  const count = people.length === 1 ? "one character" : `${people.length} characters`;
  const lines = [
    `Redraw <Picture 1> as a finished, high-quality anime-style light novel ${scene.frame === "cover" ? "cover illustration" : "illustration"} with ${count}.`,
    `<Picture 1> is only a rough 3D sketch of featureless posable figures: use it ONLY for each character's position, pose, body direction, head direction, arm and leg positions, their size, the camera angle and the framing. Keep all of these exactly. Do not draw the figures, their bare bodies, their colors or the gray floor disc${seat ? "; the brown box is the chair or seat they sit on" : ""}.`,
  ];
  people.forEach((p, i) => {
    const c = characters[p.characterId];
    const color = PERSON_COLORS[p.color % PERSON_COLORS.length].en;
    const parts = [
      `- The ${color} figure is ${c?.profile?.name ? `${c.profile.name}, ` : ""}the character from the character sheet <Picture ${i + 2}>${c && lookOf(c) ? `: ${lookOf(c)}` : ""}.`,
      `Pose: ${poseEn(p.pose)}${clean(p.action.en) ? `, ${clean(p.action.en)}` : ""}.`,
    ];
    if (clean(p.expression.en)) parts.push(`Expression: ${clean(p.expression.en)}.`);
    lines.push(parts.join(" "));
  });
  lines.push(
    people.length > 1
      ? "Each character must look exactly like their own sheet; do not mix their hair, faces or clothes."
      : "The character must look exactly like the sheet: same hair, face, eyes, outfit and accessories.",
  );
  const styles = [...new Set(people.map((p) => clean(characters[p.characterId]?.style)).filter(Boolean))];
  const sheets = people.map((_, i) => `<Picture ${i + 2}>`).join(" and ");
  lines.push(`Match the art style of ${sheets}${styles.length ? `: ${styles.join("; ")}` : ""}.`);
  lines.push(`${clean(scene.background.en) ? `Background: ${clean(scene.background.en)}. ` : ""}Full color, no text, no logo.`);
  return lines.join("\n");
}

/** 一覧に出す絵:採用した清書、なければ最後の清書か下絵 */
export function thumbnailOf(scene: Scene): string | null {
  const adopted = scene.takes.find((t) => t.id === scene.adopted);
  if (adopted?.result) return adopted.result;
  const last = [...scene.takes].reverse().find((t) => t.result || t.sketch);
  return last ? (last.result ?? last.sketch) : null;
}
