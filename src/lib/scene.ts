import { BODY_PARTS, type FigureId, PERSON_COLORS } from "./figures";
import { type PoseId, POSES } from "./poses";
import { equipmentImage, type EurosEquipment, PROP_COLORS, PROP_KINDS } from "./props";
import {
  CREATURE_FORMS,
  CREATURE_PARTS,
  type CreatureBody,
  DEFAULT_JOINTS,
  defaultBody,
  exaggeratedSize,
  guessForm,
  isExaggerated,
  NO_EXAGGERATION,
  parseBody,
  SIZE_LABELS,
  STANCES,
  type StageCreature,
} from "./creatures";
import { FURNITURE_KINDS, furnitureColor, type Place, ROOM_COLORS, seatAt, type Visible } from "./place";
import { DEFAULT_CAMERA, isCreatureTarget, type StageCamera, type StageContact, type StagePerson, type StageProp } from "./stage";

/** 清書に渡す画像の数の上限(Picture 1 の下絵を含む)。部屋・家具のデザインは、見えている割合の大きい物からこの数まで渡し、残りは文章で伝える */
export const MAX_PICTURES = 8;

/** 場面に置ける登場人物(人物と、人ではない登場人物を合わせて)の数(参照画像の数と、描き分けの安定性から) */
export const MAX_CHARACTERS = PERSON_COLORS.length;

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

/** 場面に置いた人ではない登場人物。見た目は Euros のシート(notHuman)、形と大きさは body */
export interface SceneCreature extends StageCreature {
  characterId: string;
  revisionId: string | null;
  name: string;
  /** body を Euros から読んだか、説明から推定したか(推定したものは画面で直してもらう) */
  bodyFrom: "euros" | "guess";
  action: Text;
}

/** 場面に置いた小物。寸法は実際の大きさ(cm) */
export interface SceneProp extends StageProp {
  id: string;
  /** 見た目の説明(清書のプロンプトに使う) */
  name: Text;
  /** Euros の装備品から置いたときの、装備品の id と版の id(寸法は Euros の値のまま。大きさは誇張で変える) */
  equipment?: { id: string; revisionId: string | null };
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
  /** Picture 2 以降に渡したシート(Euros のキャラクター、または装備品の id と版の id) */
  sheets: ({ characterId: string; revisionId: string | null } | { equipmentId: string; revisionId: string | null } | { placeId: string; furnitureId?: string; design: string })[];
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
  creatures: SceneCreature[];
  props: SceneProp[];
  contacts: SceneContact[];
  camera: StageCamera;
  /** 場所(Boreas のライブラリの places/<id>)。null なら場所なし(背景は文章だけ) */
  place: { id: string } | null;
  /** 背景(場所がないときは背景そのもの。場所があるときは、時間帯や窓の外など部屋の説明に足すこと) */
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
    creatures: [],
    props: [],
    contacts: [],
    camera: { ...DEFAULT_CAMERA },
    place: null,
    background: emptyText(),
    takes: [],
    adopted: null,
  };
}

/** 前の版(M1・M2)で作った場面に、あとから足した項目を補う */
export function normalizeScene(s: Scene): Scene {
  return {
    ...s,
    creatures: (s.creatures ?? []).map((c) => ({ ...c, joints: { ...DEFAULT_JOINTS, ...c.joints } })),
    props: s.props ?? [],
    contacts: s.contacts ?? [],
    camera: { ...DEFAULT_CAMERA, ...s.camera },
    place: s.place ?? null,
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
      .filter((c) => (isCreatureTarget(c.to) || c.to.person !== index) && !(c.from.kind === "hand" && c.from.person === index))
      .map((c) => ({
        ...c,
        to: isCreatureTarget(c.to) ? c.to : { ...c.to, person: shift(c.to.person) },
        from: c.from.kind === "hand" ? { ...c.from, person: shift(c.from.person) } : c.from,
      })),
  };
}

/** 人ではない登場人物を消したときに、触れる点と視線を付け直す */
export function removeCreature(s: Scene, index: number): Scene {
  const shift = (i: number) => (i > index ? i - 1 : i);
  return {
    ...s,
    creatures: s.creatures.filter((_, i) => i !== index),
    people: s.people.map((p) =>
      p.gaze?.kind === "creature" ? { ...p, gaze: p.gaze.index === index ? { kind: "manual" as const } : { kind: "creature" as const, index: shift(p.gaze.index) } } : p,
    ),
    contacts: s.contacts
      .filter((c) => !(isCreatureTarget(c.to) && c.to.creature === index))
      .map((c) => (isCreatureTarget(c.to) ? { ...c, to: { ...c.to, creature: shift(c.to.creature) } } : c)),
  };
}

/** 場面の登場人物(人物と人ではない登場人物)が使っている色 */
export const usedColors = (s: Scene) => [...s.people.map((p) => p.color), ...s.creatures.map((c) => c.color)];

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
  /** 人ではない登場人物の形と大きさ(m)。例:{ form: "sphere", size: { diameter: 0.4 } } */
  body?: unknown;
  /** 人物の身長(cm) */
  heightCm?: number;
  revisions?: { id: string; image?: string }[];
  currentRevision?: string;
}

export const isNotHuman = (c: EurosCharacter) => !!c.sheet?.notHuman;

/** 採用中の版のシート("sheets/<id>.png")と版の id */
export function currentSheet(c: EurosCharacter): { revisionId: string; image: string } | null {
  const r = c.revisions?.find((x) => x.id === c.currentRevision);
  return r?.image ? { revisionId: r.id, image: r.image } : null;
}

const ja = (c: EurosCharacter, k: string) => `${c.appearance?.[k]?.ja ?? ""} ${c.appearance?.[k]?.en ?? ""}`;

/** 身長(cm)。Euros の heightCm があればそれ、なければ説明から読む。書いていなければ性別から決める */
export function guessHeight(c: EurosCharacter, male: boolean): number {
  if (typeof c.heightCm === "number" && c.heightCm >= 80 && c.heightCm <= 250) return c.heightCm;
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

/** 外見の説明(日本語と英語をすべて)。形の種類の推定に使う */
export const describe = (c: EurosCharacter) =>
  [c.profile?.name, ...Object.values(c.appearance ?? {}).flatMap((t) => [t?.ja, t?.en])].filter(Boolean).join(" ");

/** Euros の人ではない登場人物から、場面に置く登場人物を作る。body がなければ説明から形の種類を推定する */
export function creatureFrom(c: EurosCharacter, color: number): SceneCreature {
  const body = parseBody(c.body);
  return {
    characterId: c.id,
    revisionId: currentSheet(c)?.revisionId ?? null,
    name: c.profile?.name || "(名前なし)",
    body: body ?? defaultBody(guessForm(describe(c))),
    bodyFrom: body ? "euros" : "guess",
    x: 0,
    z: 0.9,
    rotation: 180,
    color,
    lift: 0,
    tilt: 0,
    roll: 0,
    squash: 0,
    dent: null,
    joints: { ...DEFAULT_JOINTS },
    action: emptyText(),
  };
}

/** 形の種類を変えたときの体。大きさの項目は、同じ名前の項目だけ引き継ぐ */
export function changeForm(body: CreatureBody, form: CreatureBody["form"]): CreatureBody {
  const d = defaultBody(form);
  return { ...body, form, size: Object.fromEntries(Object.entries(d.size).map(([k, v]) => [k, body.size[k] ?? v])) };
}

// ---------------------------------------------------------------- 清書に渡す画像

/** Picture 2 以降に渡す画像:人物のシート(人物の順)→ 人ではない登場人物のシート → 装備品のデザイン → 部屋のデザイン → 家具のデザイン */
export type Reference =
  | { kind: "character"; characterId: string; revisionId: string; image: string }
  | { kind: "equipment"; equipmentId: string; revisionId: string | null; image: string }
  | { kind: "place"; placeId: string; image: string }
  | { kind: "furniture"; placeId: string; furnitureId: string; image: string };

/** 場面の場所と、いまのカメラから見える家具 */
export interface Room {
  place: Place;
  visible: Visible[];
}

export interface References {
  /** 渡す画像の順(シートがない登場人物は null) */
  list: (Reference | null)[];
  /** 登場人物と装備品が、何番目の画像か(Picture n の n) */
  person: number[];
  creature: number[];
  equipment: Record<string, number>;
  /** 部屋のデザインと家具のデザイン(渡さないときはない) */
  room?: number;
  furniture: Record<string, number>;
}

/** 見えている家具を、見えている割合の大きい順に */
export const visibleOrder = (room: Room) =>
  [...room.visible]
    .sort((a, b) => b.ratio - a.ratio)
    .map((v) => room.place.furniture.find((f) => f.id === v.id))
    .filter((f) => !!f);

export function referencesOf(scene: Scene, characters: Record<string, EurosCharacter>, equipment: Record<string, EurosEquipment> = {}, room?: Room | null): References {
  const list: (Reference | null)[] = [];
  const sheetOf = (characterId: string): Reference | null => {
    const c = characters[characterId];
    const sh = c ? currentSheet(c) : null;
    return sh ? { kind: "character", characterId, ...sh } : null;
  };
  // Picture 1 は下絵なので、list の n 番目(0 から)は Picture n + 2
  const person = scene.people.map((p) => list.push(sheetOf(p.characterId)) + 1);
  const creature = (scene.creatures ?? []).map((c) => list.push(sheetOf(c.characterId)) + 1);
  const eq: Record<string, number> = {};
  for (const pr of scene.props) {
    const e = pr.equipment && equipment[pr.equipment.id];
    const im = e && equipmentImage(e);
    if (!e || !im || eq[e.id]) continue;
    eq[e.id] = list.push({ kind: "equipment", equipmentId: e.id, ...im }) + 1;
  }
  // 部屋と家具のデザインは、上限(MAX_PICTURES)まで。見えない家具のデザインは渡さない
  const full = () => list.length + 1 >= MAX_PICTURES;
  const roomPicture = room?.place.design && !full() ? list.push({ kind: "place", placeId: room.place.id, image: room.place.design.file }) + 1 : undefined;
  const furniture: Record<string, number> = {};
  for (const f of room ? visibleOrder(room) : []) {
    if (!f.design || full()) continue;
    furniture[f.id] = list.push({ kind: "furniture", placeId: room!.place.id, furnitureId: f.id, image: f.design.file }) + 1;
  }
  return { list, person, creature, equipment: eq, room: roomPicture, furniture };
}

// ---------------------------------------------------------------- 清書のプロンプト

const LOOK_KEYS = ["hair", "eyes", "face", "skin", "body", "outfit", "accessories", "equipment"];

/** 外見の英語をつなげる(Picture 2 のシートと同じ見た目を言葉でも伝える)。人ではない登場人物は、項目を決めずにすべて */
export function lookOf(c: EurosCharacter): string {
  const keys = isNotHuman(c) ? Object.keys(c.appearance ?? {}).filter((k) => k !== "height") : LOOK_KEYS;
  return keys
    .map((k) => clean(c.appearance?.[k]?.en))
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
const creatureColor = (c: SceneCreature) => PERSON_COLORS[c.color % PERSON_COLORS.length].en;
const whoCreature = (creatures: SceneCreature[], i: number) => (creatures[i] ? `the ${creatureColor(creatures[i])} creature` : "the creature");

const cm = (m: number) => `${Math.round(m * 100)} cm`;

/** 人ではない登場人物の形と大きさの英語(誇張したら、そう伝える) */
function creatureShapeEn(c: SceneCreature): string {
  const size = exaggeratedSize(c.body, c.scale);
  const dims = Object.keys(CREATURE_FORMS[c.body.form].size).map(
    (k) => `${cm(size[k] ?? 0)} ${c.body.form === "quadruped" && k === "height" ? "tall at the shoulder" : (SIZE_LABELS[k]?.en ?? k)}`,
  );
  const extra: string[] = [];
  if (c.body.form === "sphere" && c.lift >= 0.05) extra.push(`floating about ${cm(c.lift)} above the ground`);
  if (c.body.form === "blob" && c.squash >= 0.15) extra.push("squashed flat");
  if (c.body.form === "blob" && c.squash <= -0.15) extra.push("stretched tall");
  if (c.body.form === "blob" && c.dent && c.dent.depth > 0) extra.push(`dented in at its ${CREATURE_PARTS[c.dent.part].en}`);
  if (c.body.form === "quadruped" || c.body.form === "biped") {
    const stance = STANCES.find((x) => x.id === c.joints.stance);
    if (stance && stance.id !== "stand") extra.push(stance.en);
    if (c.joints.mouth >= 0.3) extra.push("mouth open");
  }
  const text = `Its body is ${CREATURE_FORMS[c.body.form].en}, about ${dims.join(", ")}${extra.length ? `, ${extra.join(", ")}` : ""}.`;
  return isExaggerated(c.scale) ? `${text} It is deliberately drawn larger than its real size for emphasis; keep exactly this size.` : text;
}

const HAND_EN: Record<string, string> = { fist: "clenched in a fist", point: "pointing with the index finger", peace: "making a peace sign", open: "open" };

/**
 * 清書のプロンプト。検証で効いた形(設計書 5.7):
 * Picture 1 = 下絵は位置・ポーズ・向き・カメラだけに使い、素体の体や色は描かない。Picture 2〜 = 人物のシート(色の順)
 */
export function buildPrompt(scene: Scene, characters: Record<string, EurosCharacter>, equipment: Record<string, EurosEquipment> = {}, room?: Room | null): string {
  const { people, props, contacts } = scene;
  const creatures = scene.creatures ?? [];
  const refs = referencesOf(scene, characters, equipment, room);
  // 場所の椅子・ソファ・ベッドに座っていれば、その家具に座る。そうでなければ茶色の箱(座面の目安)に座る
  const seated = (p: ScenePerson) => !!POSES.find((d) => d.id === p.pose)?.seat;
  const seatOf = (p: ScenePerson) => (seated(p) ? seatAt(room?.place, p.x, p.z) : null);
  const seat = people.some((p) => seated(p) && !seatOf(p));
  const total = people.length + creatures.length;
  const count = total === 1 ? "one character" : `${total} characters`;
  const avoid = ["the figures", "their bare bodies", "the colors of the figures and objects", room ? "the plain flat colors of the walls, floor and furniture" : "the gray floor disc"];
  const lines = [
    `Redraw <Picture 1> as a finished, high-quality anime-style light novel ${scene.frame === "cover" ? "cover illustration" : "illustration"} with ${count}.`,
    `<Picture 1> is only a rough 3D sketch of featureless posable figures and simple shapes: use it ONLY for each character's position, pose, body direction, head direction, arm and leg positions, the objects, the sizes and distances, the camera angle and the framing. Keep all of these exactly. Do not draw ${avoid.join(", ")}${seat ? "; the brown box is the chair or seat they sit on" : ""}.`,
  ];
  people.forEach((p, i) => {
    const c = characters[p.characterId];
    const parts = [
      `- The ${colorOf(p)} figure is ${c?.profile?.name ? `${c.profile.name}, ` : ""}the character from the character sheet <Picture ${refs.person[i]}>${c && lookOf(c) ? `: ${lookOf(c)}` : ""}.`,
      `Pose: ${seatOf(p) ? SEAT_EN[seatOf(p)!.kind] : poseEn(p.pose)}${clean(p.action.en) ? `, ${clean(p.action.en)}` : ""}.`,
    ];
    const hands = (["l", "r"] as const).filter((side) => HAND_EN[p.hands?.[side] ?? ""]).map((side) => `${sideEn(side)} hand ${HAND_EN[p.hands![side]]}`);
    if (hands.length) parts.push(`Hands: ${hands.join(", ")}.`);
    const gaze = p.gaze;
    if (gaze?.kind === "camera") parts.push("Looking at the viewer.");
    if (gaze?.kind === "person" && gaze.index !== i && people[gaze.index]) parts.push(`Looking at ${who(people, gaze.index)}.`);
    if (gaze?.kind === "creature" && creatures[gaze.index]) parts.push(`Looking at ${whoCreature(creatures, gaze.index)}.`);
    if (clean(p.expression.en)) parts.push(`Expression: ${clean(p.expression.en)}.`);
    lines.push(parts.join(" "));
  });
  creatures.forEach((cr, i) => {
    const c = characters[cr.characterId];
    const color = creatureColor(cr);
    const parts = [
      `- The ${color} shape (the ${color} creature) is ${c?.profile?.name ? `${c.profile.name}, ` : ""}the non-human character from the character sheet <Picture ${refs.creature[i]}>${c && lookOf(c) ? `: ${lookOf(c)}` : ""}.`,
      creatureShapeEn(cr),
    ];
    if (clean(cr.action.en)) parts.push(`Action: ${clean(cr.action.en)}.`);
    parts.push(`Draw it as it looks on its sheet, at exactly the size, shape and position shown in <Picture 1>, keeping its size relative to the other characters; do not draw it as a plain ${color.toLowerCase()} shape.`);
    lines.push(parts.join(" "));
  });
  props.forEach((pr) => {
    const color = PROP_COLORS[pr.color % PROP_COLORS.length].en;
    const what = clean(pr.name.en) || `a ${PROP_KINDS[pr.kind].en}`;
    const k = pr.scale ?? NO_EXAGGERATION;
    const size = PROP_KINDS[pr.kind].long ? `about ${Math.round(pr.lengthCm * k.all * k.length)} cm long` : `about ${Math.round(pr.lengthCm * k.all)} cm`;
    const where = pr.holder && people[pr.holder.person] ? `, held in ${who(people, pr.holder.person)}'s ${sideEn(pr.holder.side)} hand` : ", on the ground";
    const picture = pr.equipment && refs.equipment[pr.equipment.id] ? `, the item shown in <Picture ${refs.equipment[pr.equipment.id]}>` : "";
    const big = isExaggerated(pr.scale) ? " It is deliberately drawn larger than its real size for emphasis; keep exactly this size, do not shrink it to a realistic size." : "";
    lines.push(`- The ${color} object is ${what}${picture} (${size})${where}. Draw it at exactly the size and position shown in <Picture 1>.${big}`);
  });
  if (room) lines.push(...roomLines(room, refs));
  contacts.forEach((c) => {
    const target = isCreatureTarget(c.to)
      ? `${whoCreature(creatures, c.to.creature)}'s ${CREATURE_PARTS[c.to.part].en}`
      : `${who(people, c.to.person)}'s ${BODY_PARTS[c.to.part].en}`;
    const from =
      c.from.kind === "hand"
        ? `${who(people, c.from.person)}'s ${sideEn(c.from.side)} hand`
        : `the tip of the ${PROP_COLORS[(props[c.from.prop]?.color ?? 0) % PROP_COLORS.length].en} object`;
    lines.push(`- Contact: ${from} must clearly touch ${target}, exactly where they meet in <Picture 1>; no gap between them.`);
  });
  lines.push(
    total > 1
      ? "Each character must look exactly like their own sheet; do not mix their hair, faces or clothes."
      : creatures.length
        ? "The character must look exactly like the sheet."
        : "The character must look exactly like the sheet: same hair, face, eyes, outfit and accessories.",
  );
  const ids = [...people.map((p) => p.characterId), ...creatures.map((c) => c.characterId)];
  const styles = [...new Set(ids.map((id) => clean(characters[id]?.style)).filter(Boolean))];
  const sheets = [...refs.person, ...refs.creature].map((n) => `<Picture ${n}>`).join(" and ");
  lines.push(`Match the art style of ${sheets}${styles.length ? `: ${styles.join("; ")}` : ""}.`);
  lines.push(`${clean(scene.background.en) ? `Background: ${clean(scene.background.en)}. ` : ""}Full color, no text, no logo.`);
  return lines.join("\n");
}

const SEAT_EN: Record<string, string> = { chair: "sitting on the chair", sofa: "sitting on the sofa", bed: "sitting on the edge of the bed" };

/** 部屋と、カメラから見える家具のプロンプト。見えない家具は書かない(同じ部屋の別の場面で、見える物が食い違わないように) */
function roomLines(room: Room, refs: References): string[] {
  const { place } = room;
  const desc = clean(place.description.en);
  const kinds = new Set(place.openings.map((o) => o.kind));
  const openings = [kinds.has("window") ? `the windows (${ROOM_COLORS.window.en})` : "", kinds.has("door") ? `the doors (${ROOM_COLORS.door.en})` : ""].filter(Boolean).join(" and ");
  const same = refs.room ? `. It is the room shown in <Picture ${refs.room}>; draw its walls, floor, windows and lighting in the same way` : "";
  const lines = [
    `- The room: the ${ROOM_COLORS.wall.en} walls, the ${ROOM_COLORS.floor.en} floor and the ceiling in <Picture 1> are the walls, floor and ceiling of ${desc ? `this room: ${desc}` : "the room"}${same}. Keep the shape of the room${openings ? ` and ${openings}` : ""} exactly where they are in <Picture 1>, but paint the walls, floor and ceiling with the room's own materials and colors (its flooring and wallpaper), never plain gray.`,
  ];
  const furniture = visibleOrder(room);
  for (const f of furniture) {
    const what = clean(f.name.en) || `a ${FURNITURE_KINDS[f.kind].en}`;
    const picture = refs.furniture[f.id] ? `, the furniture shown in <Picture ${refs.furniture[f.id]}>` : "";
    const size = `about ${Math.round(f.widthCm)} cm wide, ${Math.round(f.depthCm)} cm deep, ${Math.round(f.heightCm)} cm tall`;
    // 一部だけ写る家具は、そう伝える(端に少し写る物を、別の物に描き変えないように)
    const partly = (room.visible.find((v) => v.id === f.id)?.ratio ?? 1) < 0.5 ? ` Only part of it is in the frame; draw that part as the ${FURNITURE_KINDS[f.kind].en}.` : "";
    lines.push(`- The ${furnitureColor(f).en} box shape is the ${FURNITURE_KINDS[f.kind].en}: ${what}${picture} (${size}). Keep its size, direction and position exactly as in <Picture 1>.${partly}`);
  }
  lines.push(furniture.length ? "Draw only the furniture shown in <Picture 1>; do not add other large furniture." : "No furniture of the room is visible from this camera; do not add large furniture.");
  return lines;
}

/** 一覧に出す絵:採用した清書、なければ最後の清書か下絵 */
export function thumbnailOf(scene: Scene): string | null {
  const adopted = scene.takes.find((t) => t.id === scene.adopted);
  if (adopted?.result) return adopted.result;
  const last = [...scene.takes].reverse().find((t) => t.result || t.sketch);
  return last ? (last.result ?? last.sketch) : null;
}
