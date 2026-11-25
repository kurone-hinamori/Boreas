import { BODY_PARTS, type FigureId, PERSON_COLORS } from "./figures";
import { type PoseId, POSES } from "./poses";
import { PROP_COLORS, PROP_KINDS } from "./props";
import { DEFAULT_CAMERA, type StageCamera, type StageContact, type StagePerson, type StageProp } from "./stage";

/** 場面に置ける人物の数(参照画像の数と、描き分けの安定性から) */
export const MAX_PEOPLE = PERSON_COLORS.length;

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

/** 場面に置いた小物。寸法は実際の大きさ(cm) */
export interface SceneProp extends StageProp {
  id: string;
  /** 見た目の説明(清書のプロンプトに使う) */
  name: Text;
}

/** 触れる点(「Aの右手 → Bの肩」など) */
export interface SceneContact extends StageContact {
  id: string;
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
  props: SceneProp[];
  contacts: SceneContact[];
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
    props: [],
    contacts: [],
    camera: { ...DEFAULT_CAMERA },
    background: emptyText(),
    takes: [],
    adopted: null,
  };
}

/** 前の版(M1)で作った場面に、あとから足した項目を補う */
export function normalizeScene(s: Scene): Scene {
  return {
    ...s,
    props: s.props ?? [],
    contacts: s.contacts ?? [],
    camera: { ...DEFAULT_CAMERA, ...s.camera },
    people: s.people.map((p) => ({ hands: { l: "auto", r: "auto" }, ik: {}, gaze: { kind: "manual" }, ...p })),
  };
}

/** まだ使っていない色の番号 */
export function freeColor(used: number[], count: number): number {
  for (let i = 0; i < count; i++) if (!used.includes(i)) return i;
  return used.length % count;
}

/** 人物を消したときに、番号で指している物(小物の持ち主・触れる点・視線)を付け直す */
export function removePerson(s: Scene, index: number): Scene {
  const shift = (i: number) => (i > index ? i - 1 : i);
  return {
    ...s,
    people: s.people
      .filter((_, i) => i !== index)
      .map((p) => (p.gaze?.kind === "person" ? { ...p, gaze: p.gaze.index === index ? { kind: "manual" as const } : { kind: "person" as const, index: shift(p.gaze.index) } } : p)),
    props: s.props.map((pr) => (pr.holder ? (pr.holder.person === index ? { ...pr, holder: null } : { ...pr, holder: { ...pr.holder, person: shift(pr.holder.person) } }) : pr)),
    contacts: s.contacts
      .filter((c) => c.to.person !== index && !(c.from.kind === "hand" && c.from.person === index))
      .map((c) => ({ ...c, to: { ...c.to, person: shift(c.to.person) }, from: c.from.kind === "hand" ? { ...c.from, person: shift(c.from.person) } : c.from })),
  };
}

/** 小物を消したときに、触れる点を付け直す */
export function removeProp(s: Scene, index: number): Scene {
  return {
    ...s,
    props: s.props.filter((_, i) => i !== index),
    contacts: s.contacts
      .filter((c) => !(c.from.kind === "prop" && c.from.prop === index))
      .map((c) => (c.from.kind === "prop" && c.from.prop > index ? { ...c, from: { kind: "prop" as const, prop: c.from.prop - 1 } } : c)),
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

/** Euros のキャラクターから、場面に置く人物を作る。color は色の番号 */
export function personFrom(c: EurosCharacter, color: number): ScenePerson {
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
    color,
    hands: { l: "auto", r: "auto" },
    ik: {},
    gaze: { kind: "manual" },
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

const colorOf = (p: ScenePerson) => PERSON_COLORS[p.color % PERSON_COLORS.length].en;
const sideEn = (side: "l" | "r") => (side === "l" ? "left" : "right");

/** 人物を指す言葉(「the RED character」) */
const who = (people: ScenePerson[], i: number) => (people[i] ? `the ${colorOf(people[i])} character` : "someone");

const HAND_EN: Record<string, string> = { fist: "clenched in a fist", point: "pointing with the index finger", peace: "making a peace sign", open: "open" };

/**
 * 清書のプロンプト。検証で効いた形(設計書 5.7):
 * Picture 1 = 下絵は位置・ポーズ・向き・カメラだけに使い、素体の体や色は描かない。Picture 2〜 = 人物のシート(色の順)
 */
export function buildPrompt(scene: Scene, characters: Record<string, EurosCharacter>): string {
  const { people, props, contacts } = scene;
  const seat = people.some((p) => POSES.find((d) => d.id === p.pose)?.seat);
  const count = people.length === 1 ? "one character" : `${people.length} characters`;
  const avoid = ["the figures", "their bare bodies", "the colors of the figures and objects", "the gray floor disc"];
  const lines = [
    `Redraw <Picture 1> as a finished, high-quality anime-style light novel ${scene.frame === "cover" ? "cover illustration" : "illustration"} with ${count}.`,
    `<Picture 1> is only a rough 3D sketch of featureless posable figures and simple shapes: use it ONLY for each character's position, pose, body direction, head direction, arm and leg positions, the objects, the sizes and distances, the camera angle and the framing. Keep all of these exactly. Do not draw ${avoid.join(", ")}${seat ? "; the brown box is the chair or seat they sit on" : ""}.`,
  ];
  people.forEach((p, i) => {
    const c = characters[p.characterId];
    const parts = [
      `- The ${colorOf(p)} figure is ${c?.profile?.name ? `${c.profile.name}, ` : ""}the character from the character sheet <Picture ${i + 2}>${c && lookOf(c) ? `: ${lookOf(c)}` : ""}.`,
      `Pose: ${poseEn(p.pose)}${clean(p.action.en) ? `, ${clean(p.action.en)}` : ""}.`,
    ];
    const hands = (["l", "r"] as const).filter((side) => HAND_EN[p.hands?.[side] ?? ""]).map((side) => `${sideEn(side)} hand ${HAND_EN[p.hands![side]]}`);
    if (hands.length) parts.push(`Hands: ${hands.join(", ")}.`);
    const gaze = p.gaze;
    if (gaze?.kind === "camera") parts.push("Looking at the viewer.");
    if (gaze?.kind === "person" && gaze.index !== i && people[gaze.index]) parts.push(`Looking at ${who(people, gaze.index)}.`);
    if (clean(p.expression.en)) parts.push(`Expression: ${clean(p.expression.en)}.`);
    lines.push(parts.join(" "));
  });
  props.forEach((pr) => {
    const color = PROP_COLORS[pr.color % PROP_COLORS.length].en;
    const what = clean(pr.name.en) || `a ${PROP_KINDS[pr.kind].en}`;
    const k = pr.scale ?? { all: 1, length: 1, width: 1 };
    const size = PROP_KINDS[pr.kind].long ? `about ${Math.round(pr.lengthCm * k.all * k.length)} cm long` : `about ${Math.round(pr.lengthCm * k.all)} cm`;
    const where = pr.holder && people[pr.holder.person] ? `, held in ${who(people, pr.holder.person)}'s ${sideEn(pr.holder.side)} hand` : ", on the ground";
    lines.push(`- The ${color} object is ${what} (${size})${where}. Draw it at exactly the size and position shown in <Picture 1>.`);
  });
  contacts.forEach((c) => {
    const target = `${who(people, c.to.person)}'s ${BODY_PARTS[c.to.part].en}`;
    const from =
      c.from.kind === "hand"
        ? `${who(people, c.from.person)}'s ${sideEn(c.from.side)} hand`
        : `the tip of the ${PROP_COLORS[(props[c.from.prop]?.color ?? 0) % PROP_COLORS.length].en} object`;
    lines.push(`- Contact: ${from} must clearly touch ${target}, exactly where they meet in <Picture 1>; no gap between them.`);
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
