import * as THREE from "three";

// 場所(部屋・家具)。設計書 5.4。同じ部屋の別の場面で見える物が食い違わないよう、部屋を間取り図と寸法で持つ。
// 寸法と位置は cm。場面の座標(m)と原点・向きは同じで、+X が右(カメラの初期位置から見て)、+Z が手前、+Y が上。
// 間取り図は上から見た図で、+X を右、+Z を下に描く。

/** 日本語と、清書に使う英語 */
export interface Text {
  ja: string;
  en: string;
}

/** 床の長方形(cm)。x・z は小さい方の角 */
export interface FloorRect {
  x: number;
  z: number;
  width: number;
  depth: number;
}

export type OpeningKind = "door" | "window";

export const OPENING_KINDS = {
  door: { label: "ドア", en: "door", size: { widthCm: 80, heightCm: 200, sillCm: 0 } },
  window: { label: "窓", en: "window", size: { widthCm: 120, heightCm: 110, sillCm: 90 } },
} as const;

/** 窓・ドア。x・z は壁の上の中心(cm)。壁から離れていれば、いちばん近い壁に寄せる */
export interface Opening {
  id: string;
  kind: OpeningKind;
  x: number;
  z: number;
  widthCm: number;
  heightCm: number;
  /** 床から下端までの高さ(窓) */
  sillCm: number;
}

/** 家具の型。size は初期値、range はありえる寸法(これを外れたら警告する)、seat は座面の高さの初期値 */
export const FURNITURE_KINDS = {
  bed: { label: "ベッド", en: "bed", size: { widthCm: 100, depthCm: 200, heightCm: 80 }, seat: 45, range: { w: [70, 220], d: [170, 240], h: [25, 140], seat: [20, 70] } },
  desk: { label: "机", en: "desk", size: { widthCm: 100, depthCm: 60, heightCm: 72 }, range: { w: [50, 220], d: [35, 100], h: [55, 120] } },
  chair: { label: "椅子", en: "chair", size: { widthCm: 44, depthCm: 48, heightCm: 82 }, seat: 44, range: { w: [30, 80], d: [30, 80], h: [55, 130], seat: [30, 60] } },
  sofa: { label: "ソファ", en: "sofa", size: { widthCm: 160, depthCm: 80, heightCm: 80 }, seat: 42, range: { w: [70, 320], d: [55, 120], h: [55, 115], seat: [30, 55] } },
  table: { label: "テーブル", en: "table", size: { widthCm: 90, depthCm: 60, heightCm: 40 }, range: { w: [35, 250], d: [35, 130], h: [25, 85] } },
  shelf: { label: "本棚", en: "bookshelf", size: { widthCm: 80, depthCm: 30, heightCm: 180 }, range: { w: [25, 250], d: [15, 60], h: [30, 250] } },
  wardrobe: { label: "タンス", en: "wardrobe", size: { widthCm: 90, depthCm: 55, heightCm: 180 }, range: { w: [40, 250], d: [30, 75], h: [50, 250] } },
  cabinet: { label: "低い棚・テレビ台", en: "low cabinet", size: { widthCm: 120, depthCm: 40, heightCm: 45 }, range: { w: [30, 250], d: [20, 65], h: [20, 120] } },
  tv: { label: "テレビ", en: "television", size: { widthCm: 100, depthCm: 8, heightCm: 60 }, elevation: 45, range: { w: [30, 250], d: [2, 30], h: [20, 150] } },
  box: { label: "箱(そのほか)", en: "object", size: { widthCm: 50, depthCm: 50, heightCm: 50 }, range: null },
} as const satisfies Record<string, { label: string; en: string; size: { widthCm: number; depthCm: number; heightCm: number }; seat?: number; elevation?: number; range: { w: number[]; d: number[]; h: number[]; seat?: number[] } | null }>;

export type FurnitureKind = keyof typeof FURNITURE_KINDS;

/** 家具の色。人物(赤・青・緑・橙)・小物(紫・水色・黄・桃)と重ならない色。下絵では、この色の物 = この家具、とプロンプトで伝える */
export const FURNITURE_COLORS = [
  { hex: 0x8a5a2b, en: "BROWN", label: "茶" },
  { hex: 0x2a3f7a, en: "NAVY", label: "紺" },
  { hex: 0x7d7d22, en: "OLIVE", label: "オリーブ" },
  { hex: 0x2a8070, en: "TEAL", label: "青緑" },
  { hex: 0x7a2a3a, en: "MAROON", label: "えんじ" },
  { hex: 0xc9a878, en: "TAN", label: "薄茶" },
  { hex: 0x505a66, en: "SLATE GRAY", label: "濃い灰" },
  { hex: 0x9acd5a, en: "LIME", label: "黄緑" },
] as const;

/** デザインの画像(ComfyUI で作る)。同じ絵を作り直せるよう、プロンプトと seed も残す */
export interface Design {
  /** "designs/<id>.png" */
  file: string;
  prompt: string;
  seed: number;
  createdAt: string;
}

export interface Furniture {
  id: string;
  kind: FurnitureKind;
  /** 見た目の説明(「木目の勉強机、上に古いモニター」など)。デザインとプロンプトに使う */
  name: Text;
  /** 中心の位置(cm)と向き(度。0 で正面が +Z、間取り図の下を向く) */
  x: number;
  z: number;
  rotation: number;
  widthCm: number;
  depthCm: number;
  heightCm: number;
  /** 座面の高さ(cm。椅子・ソファ・ベッド) */
  seatCm?: number;
  /** 床から浮かせる高さ(cm。台の上のテレビなど) */
  elevationCm?: number;
  /** 色の番号(FURNITURE_COLORS) */
  color: number;
  design: Design | null;
}

export interface Place {
  schemaVersion: number;
  app: "Boreas";
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** 床の形(長方形の組み合わせ)と天井の高さ(cm) */
  floor: FloorRect[];
  ceilingCm: number;
  openings: Opening[];
  furniture: Furniture[];
  /** 部屋の説明(壁・床・窓の外・明かりなど) */
  description: Text;
  /** 画風(部屋と家具のデザインのプロンプトの先頭に入れる)。空なら既定の画風(design.ts の DEFAULT_STYLE_EN) */
  style: Text;
  /** 部屋のデザイン(人物のいない部屋の絵)。清書で背景の参照にする */
  design: Design | null;
}

/** place.json の形の版。形を変えたら上げる */
export const PLACE_SCHEMA_VERSION = 1;

export function newPlaceId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

/** 新しい場所。6畳(360×270cm)ほどの部屋を、場面の原点が真ん中に来るように置く */
export function newPlace(title: string): Place {
  const now = new Date().toISOString();
  return {
    schemaVersion: PLACE_SCHEMA_VERSION,
    app: "Boreas",
    id: newPlaceId(),
    title,
    createdAt: now,
    updatedAt: now,
    floor: [{ x: -180, z: -135, width: 360, depth: 270 }],
    ceilingCm: 240,
    openings: [],
    furniture: [],
    description: { ja: "", en: "" },
    style: { ja: "", en: "" },
    design: null,
  };
}

export function normalizePlace(p: Place): Place {
  return {
    ...p,
    floor: p.floor?.length ? p.floor : [{ x: -180, z: -135, width: 360, depth: 270 }],
    ceilingCm: p.ceilingCm || 240,
    openings: p.openings ?? [],
    furniture: (p.furniture ?? []).map((f) => ({ ...f, name: f.name ?? { ja: "", en: "" }, design: f.design ?? null })),
    description: p.description ?? { ja: "", en: "" },
    style: p.style ?? { ja: "", en: "" },
    design: p.design ?? null,
  };
}

export function newFurniture(kind: FurnitureKind, used: number[], at: { x: number; z: number }): Furniture {
  const k = FURNITURE_KINDS[kind];
  return {
    id: newPlaceId(),
    kind,
    name: { ja: "", en: "" },
    x: at.x,
    z: at.z,
    rotation: 0,
    ...k.size,
    ...("seat" in k ? { seatCm: k.seat } : {}),
    ...("elevation" in k ? { elevationCm: k.elevation } : {}),
    color: freeIndex(used, FURNITURE_COLORS.length),
    design: null,
  };
}

const freeIndex = (used: number[], count: number) => {
  for (let i = 0; i < count; i++) if (!used.includes(i)) return i;
  return used.length % count;
};

export const furnitureLabel = (f: Furniture) => f.name.ja.trim() || FURNITURE_KINDS[f.kind].label;
export const furnitureColor = (f: Furniture) => FURNITURE_COLORS[f.color % FURNITURE_COLORS.length];
export const isSeat = (f: Furniture) => f.kind === "chair" || f.kind === "sofa" || f.kind === "bed";
export const seatHeight = (f: Furniture) => f.seatCm ?? ("seat" in FURNITURE_KINDS[f.kind] ? (FURNITURE_KINDS[f.kind] as { seat: number }).seat : f.heightCm);

// ---------------------------------------------------------------- 形の計算(間取り図の平面、cm)

export type P2 = [number, number];

const rad = (deg: number) => (deg * Math.PI) / 180;

/** 家具から見た位置(cm。three.js と同じく、家具の向きの分だけ Y 軸まわりに回す)を、部屋の位置にする */
export function toPlace(f: Pick<Furniture, "x" | "z" | "rotation">, lx: number, lz: number): P2 {
  const r = rad(f.rotation);
  return [f.x + lx * Math.cos(r) + lz * Math.sin(r), f.z - lx * Math.sin(r) + lz * Math.cos(r)];
}

/** 部屋の位置を、家具から見た位置にする */
export function toFurniture(f: Pick<Furniture, "x" | "z" | "rotation">, x: number, z: number): P2 {
  const r = rad(f.rotation);
  const dx = x - f.x;
  const dz = z - f.z;
  return [dx * Math.cos(r) - dz * Math.sin(r), dx * Math.sin(r) + dz * Math.cos(r)];
}

/** 家具の床の上の四隅 */
export function footprint(f: Pick<Furniture, "x" | "z" | "rotation" | "widthCm" | "depthCm">): P2[] {
  const w = f.widthCm / 2;
  const d = f.depthCm / 2;
  return [toPlace(f, -w, -d), toPlace(f, w, -d), toPlace(f, w, d), toPlace(f, -w, d)];
}

/** 点が床の上か(端から tol cm までは床とみなす) */
export function onFloor(floor: FloorRect[], [x, z]: P2, tol = 0.5): boolean {
  return floor.some((r) => x >= r.x - tol && x <= r.x + r.width + tol && z >= r.z - tol && z <= r.z + r.depth + tol);
}

/** 壁。a から b へ、normal は部屋の内側の向き */
export interface Wall {
  a: P2;
  b: P2;
  normal: P2;
}

/** 床の長方形の組み合わせから、外側の縁(壁)を求める。長方形どうしが接する所・重なる所には壁を作らない */
export function wallsOf(floor: FloorRect[]): Wall[] {
  const inside = (x: number, z: number) => floor.some((r) => x > r.x && x < r.x + r.width && z > r.z && z < r.z + r.depth);
  const xs = [...new Set(floor.flatMap((r) => [r.x, r.x + r.width]))].sort((a, b) => a - b);
  const zs = [...new Set(floor.flatMap((r) => [r.z, r.z + r.depth]))].sort((a, b) => a - b);
  const pieces: Wall[] = [];
  for (const r of floor) {
    const x0 = r.x;
    const x1 = r.x + r.width;
    const z0 = r.z;
    const z1 = r.z + r.depth;
    // 4辺。外向き(out)の少し先が床でなければ壁
    const edges: { fixed: number; from: number; to: number; along: "x" | "z"; out: number }[] = [
      { fixed: z0, from: x0, to: x1, along: "x", out: -1 },
      { fixed: z1, from: x0, to: x1, along: "x", out: 1 },
      { fixed: x0, from: z0, to: z1, along: "z", out: -1 },
      { fixed: x1, from: z0, to: z1, along: "z", out: 1 },
    ];
    for (const e of edges) {
      const cuts = [e.from, ...(e.along === "x" ? xs : zs).filter((v) => v > e.from && v < e.to), e.to];
      for (let i = 0; i + 1 < cuts.length; i++) {
        const m = (cuts[i] + cuts[i + 1]) / 2;
        const [px, pz] = e.along === "x" ? [m, e.fixed + e.out * 0.5] : [e.fixed + e.out * 0.5, m];
        if (inside(px, pz)) continue;
        const a: P2 = e.along === "x" ? [cuts[i], e.fixed] : [e.fixed, cuts[i]];
        const b: P2 = e.along === "x" ? [cuts[i + 1], e.fixed] : [e.fixed, cuts[i + 1]];
        pieces.push({ a, b, normal: e.along === "x" ? [0, -e.out] : [-e.out, 0] });
      }
    }
  }
  // 同じ線の上で続いている壁はつなぐ(窓やドアが切れ目をまたげるように)
  const key = (w: Wall) => `${w.normal.join(",")}:${w.normal[0] === 0 ? w.a[1] : w.a[0]}`;
  const groups = new Map<string, Wall[]>();
  for (const w of pieces) groups.set(key(w), [...(groups.get(key(w)) ?? []), w]);
  const merged: Wall[] = [];
  for (const list of groups.values()) {
    const along = list[0].normal[0] === 0 ? 0 : 1;
    list.sort((p, q) => p.a[along] - q.a[along]);
    let cur = { ...list[0] };
    for (const w of list.slice(1)) {
      if (Math.abs(w.a[along] - cur.b[along]) < 0.01) cur = { ...cur, b: w.b };
      else {
        merged.push(cur);
        cur = { ...w };
      }
    }
    merged.push(cur);
  }
  // 壁の向きをそろえる:a→b の向きを u とすると、u × 上 = 内側(3D で壁の表が内側を向くように)
  return merged.map((w) => {
    const ux = w.b[0] - w.a[0];
    const uz = w.b[1] - w.a[1];
    return -uz * w.normal[0] + ux * w.normal[1] < 0 ? { ...w, a: w.b, b: w.a } : w;
  });
}

const wallLength = (w: Wall) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);

/** 点からいちばん近い壁と、壁の上の位置(a からの距離 cm)と、壁までの距離 */
export function nearestWall(walls: Wall[], [x, z]: P2): { wall: Wall; index: number; along: number; distance: number } | null {
  let best: { wall: Wall; index: number; along: number; distance: number } | null = null;
  walls.forEach((w, index) => {
    const L = wallLength(w);
    if (L < 1e-6) return;
    const ux = (w.b[0] - w.a[0]) / L;
    const uz = (w.b[1] - w.a[1]) / L;
    const along = Math.min(L, Math.max(0, (x - w.a[0]) * ux + (z - w.a[1]) * uz));
    const distance = Math.hypot(x - (w.a[0] + ux * along), z - (w.a[1] + uz * along));
    if (!best || distance < best.distance) best = { wall: w, index, along, distance };
  });
  return best;
}

/** 窓・ドアを、いちばん近い壁の上に寄せる(壁からはみ出さないように) */
export function snapOpening(walls: Wall[], o: Pick<Opening, "x" | "z" | "widthCm">): P2 {
  const near = nearestWall(walls, [o.x, o.z]);
  if (!near) return [o.x, o.z];
  const L = wallLength(near.wall);
  const half = Math.min(o.widthCm / 2, L / 2);
  const along = Math.min(L - half, Math.max(half, near.along));
  const k = along / L;
  const r = (v: number) => Math.round(v * 10) / 10;
  return [r(near.wall.a[0] + (near.wall.b[0] - near.wall.a[0]) * k), r(near.wall.a[1] + (near.wall.b[1] - near.wall.a[1]) * k)];
}

/** 2つの凸な四角形(四隅)が重なるか(分離軸で調べる)。tol cm までの食い込みは重ならないとみなす */
export function overlaps(a: P2[], b: P2[], tol = 1): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 1e-9) continue;
      const nx = -(q[1] - p[1]) / len;
      const nz = (q[0] - p[0]) / len;
      const proj = (poly2: P2[]) => poly2.map(([x, z]) => x * nx + z * nz);
      const pa = proj(a);
      const pb = proj(b);
      if (Math.max(...pa) - tol <= Math.min(...pb) || Math.max(...pb) - tol <= Math.min(...pa)) return false;
    }
  }
  return true;
}

/** 家具の、ぶつかる高さの範囲(cm)。机・テーブルは天板だけ(下に椅子や脚を入れられる)、椅子は座面まで(机の下に入れられる) */
export function solidRange(f: Furniture): [number, number] {
  const e = f.elevationCm ?? 0;
  if (f.kind === "desk" || f.kind === "table") return [e + f.heightCm - 4, e + f.heightCm];
  if (f.kind === "chair") return [e, e + seatHeight(f)];
  return [e, e + f.heightCm];
}

/** 窓・ドアの前の、ふさいではいけない範囲(四隅)。ドアは開け閉めと出入りの分、窓は窓の前の少し */
function openingZone(walls: Wall[], o: Opening): P2[] | null {
  const near = nearestWall(walls, [o.x, o.z]);
  if (!near || near.distance > 5) return null;
  const w = near.wall;
  const L = wallLength(w);
  const ux = (w.b[0] - w.a[0]) / L;
  const uz = (w.b[1] - w.a[1]) / L;
  const half = o.widthCm / 2;
  const depth = o.kind === "door" ? 60 : 20;
  const c: P2 = [w.a[0] + ux * near.along, w.a[1] + uz * near.along];
  const n = w.normal;
  return [
    [c[0] - ux * half, c[1] - uz * half],
    [c[0] + ux * half, c[1] + uz * half],
    [c[0] + ux * half + n[0] * depth, c[1] + uz * half + n[1] * depth],
    [c[0] - ux * half + n[0] * depth, c[1] - uz * half + n[1] * depth],
  ];
}

export interface Warning {
  /** 警告の対象(家具か窓・ドアの id) */
  target: string;
  text: string;
}

const KIND_SIZE_LABEL = { w: "幅", d: "奥行き", h: "高さ", seat: "座面の高さ" } as const;

/** 寸法の点検(設計書 5.4):部屋に入らない・壁や他の家具にめり込む・ドアや窓をふさぐ・ありえない寸法 */
export function checkPlace(place: Place): Warning[] {
  const out: Warning[] = [];
  const walls = wallsOf(place.floor);
  const name = furnitureLabel;
  for (const f of place.furniture) {
    const corners = footprint(f);
    // 四隅と辺の真ん中が床の上にあるか(L 字の部屋の角にもかかるよう、辺の上も見る)
    const samples = corners.flatMap((p, i) => {
      const q = corners[(i + 1) % 4];
      return [p, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as P2];
    });
    if (samples.some((p) => !onFloor(place.floor, p))) out.push({ target: f.id, text: `${name(f)}が部屋に入りません(壁にめり込んでいます)` });
    const top = (f.elevationCm ?? 0) + f.heightCm;
    if (top > place.ceilingCm) out.push({ target: f.id, text: `${name(f)}が天井より高くなっています(${Math.round(top)}cm、天井は${place.ceilingCm}cm)` });
    const range = FURNITURE_KINDS[f.kind].range as { w: number[]; d: number[]; h: number[]; seat?: number[] } | null;
    if (range) {
      const values = { w: f.widthCm, d: f.depthCm, h: f.heightCm, seat: isSeat(f) ? seatHeight(f) : undefined };
      for (const k of ["w", "d", "h", "seat"] as const) {
        const v = values[k];
        const r = range[k];
        if (v === undefined || !r) continue;
        if (v < r[0] || v > r[1]) out.push({ target: f.id, text: `${FURNITURE_KINDS[f.kind].label}の${KIND_SIZE_LABEL[k]}が ${v}cm です(ふつうは ${r[0]}〜${r[1]}cm)` });
      }
      if (isSeat(f) && seatHeight(f) > f.heightCm) out.push({ target: f.id, text: `${name(f)}の座面が全体の高さより高くなっています` });
    }
  }
  // 家具どうしが重なる(高さの範囲も重なるときだけ。台の上のテレビ、机の下の椅子は重ならない)
  place.furniture.forEach((a, i) => {
    for (const b of place.furniture.slice(i + 1)) {
      const [a0, a1] = solidRange(a);
      const [b0, b1] = solidRange(b);
      if (Math.min(a1, b1) - Math.max(a0, b0) <= 0.5) continue;
      if (overlaps(footprint(a), footprint(b))) out.push({ target: a.id, text: `${name(a)}と${name(b)}が重なっています` }, { target: b.id, text: `${name(b)}と${name(a)}が重なっています` });
    }
  });
  // 窓・ドア
  for (const o of place.openings) {
    const label = OPENING_KINDS[o.kind].label;
    const near = nearestWall(walls, [o.x, o.z]);
    if (!near || near.distance > 5) {
      out.push({ target: o.id, text: `${label}が壁の上にありません` });
      continue;
    }
    if (o.widthCm > wallLength(near.wall) + 0.5) out.push({ target: o.id, text: `${label}の幅(${o.widthCm}cm)が壁(${Math.round(wallLength(near.wall))}cm)より広くなっています` });
    if (o.sillCm + o.heightCm > place.ceilingCm) out.push({ target: o.id, text: `${label}が天井より高くなっています` });
    const zone = openingZone(walls, o);
    if (!zone) continue;
    for (const f of place.furniture) {
      const bottom = f.elevationCm ?? 0;
      const top = bottom + f.heightCm;
      // ドアは床から上の家具すべて、窓は窓の高さにかかる家具
      const blocks = o.kind === "door" ? bottom < o.heightCm : top > o.sillCm + 10 && bottom < o.sillCm + o.heightCm;
      if (blocks && overlaps(footprint(f), zone)) out.push({ target: f.id, text: `${name(f)}が${label}をふさいでいます` });
    }
  }
  return out;
}

/** 床の範囲(cm):[最小 x, 最小 z, 最大 x, 最大 z] */
export function floorBounds(floor: FloorRect[]): [number, number, number, number] {
  if (!floor.length) return [-180, -135, 180, 135];
  return [Math.min(...floor.map((r) => r.x)), Math.min(...floor.map((r) => r.z)), Math.max(...floor.map((r) => r.x + r.width)), Math.max(...floor.map((r) => r.z + r.depth))];
}

// ---------------------------------------------------------------- 人物を座らせる

/** 立ち位置(m)が座面の上にある、椅子・ソファ・ベッド */
export function seatAt(place: Place | null | undefined, xM: number, zM: number): Furniture | null {
  if (!place) return null;
  const x = xM * 100;
  const z = zM * 100;
  for (const f of place.furniture) {
    if (!isSeat(f)) continue;
    const [lx, lz] = toFurniture(f, x, z);
    if (Math.abs(lx) <= f.widthCm / 2 + 5 && Math.abs(lz) <= f.depthCm / 2 + 5) return f;
  }
  return null;
}

/** 家具に座らせるときの立ち位置(m)と向き(度)。椅子・ソファは正面向き、ベッドは横(家具から見て +X の縁)に腰かける */
export function seatPose(f: Furniture): { x: number; z: number; rotation: number } {
  const r = (v: number) => Math.round(v * 100) / 100;
  const norm = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;
  if (f.kind === "bed") {
    const [x, z] = toPlace(f, f.widthCm / 2 - 22, f.depthCm * 0.1);
    return { x: r(x / 100), z: r(z / 100), rotation: norm(f.rotation + 90) };
  }
  // 椅子は背もたれの分だけ前に。ソファは座面の奥行きの真ん中
  const [x, z] = toPlace(f, 0, f.kind === "chair" ? 3 : f.depthCm * 0.12);
  return { x: r(x / 100), z: r(z / 100), rotation: norm(f.rotation) };
}

// ---------------------------------------------------------------- 3D の目安(m)

/** 下絵の部屋の色(清書では、部屋の説明どおりに描き変えてもらう) */
export const ROOM_COLORS = {
  floor: { hex: 0xc4c4c4, en: "medium gray" },
  wall: { hex: 0xe2e2e2, en: "light gray" },
  /** 左右(X の向き)の壁。奥の壁と少しだけ変え、部屋の角が分かるようにする */
  sideWall: { hex: 0xd4d4d4, en: "light gray" },
  ceiling: { hex: 0xeeeeee, en: "light gray" },
  door: { hex: 0x5a5a5a, en: "dark gray" },
  window: { hex: 0xa8d0f0, en: "pale blue" },
} as const;

const mat = (hex: number) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.8, metalness: 0 });
/** 部屋の面は明かりで暗くしない(影になった壁が、ドアと同じ濃い灰色に見えて、清書でドアに描かれた) */
const flat = (hex: number) => new THREE.MeshBasicMaterial({ color: hex });

/** 部屋(床・壁・天井・窓・ドア)。壁と天井は内側からだけ見える(外にカメラを置くと、手前の壁は写らない) */
export function buildRoom(place: Place): THREE.Group {
  const g = new THREE.Group();
  g.name = "room";
  const H = place.ceilingCm / 100;
  for (const r of place.floor) {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(r.width / 100, r.depth / 100), flat(ROOM_COLORS.floor.hex));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((r.x + r.width / 2) / 100, 0, (r.z + r.depth / 2) / 100);
    floor.userData.surface = "floor";
    const ceiling = floor.clone();
    ceiling.material = flat(ROOM_COLORS.ceiling.hex);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = H;
    ceiling.userData.surface = "ceiling";
    g.add(floor, ceiling);
  }
  const walls = wallsOf(place.floor);
  walls.forEach((w, index) => {
    const L = wallLength(w) / 100;
    const holes = place.openings
      .map((o) => ({ o, near: nearestWall(walls, [o.x, o.z]) }))
      .filter(({ near }) => near && near.index === index && near.distance <= 5);
    // 壁の面:u は a から b、v は床から上(m)
    const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(L, 0), new THREE.Vector2(L, H), new THREE.Vector2(0, H)]);
    const panels: THREE.Mesh[] = [];
    for (const { o, near } of holes) {
      const u0 = Math.max(0.01, near!.along / 100 - o.widthCm / 200);
      const u1 = Math.min(L - 0.01, near!.along / 100 + o.widthCm / 200);
      const v0 = Math.max(o.kind === "door" ? 0.001 : 0.01, o.sillCm / 100);
      const v1 = Math.min(H - 0.01, (o.sillCm + o.heightCm) / 100);
      if (u1 <= u0 || v1 <= v0) continue;
      shape.holes.push(new THREE.Path([new THREE.Vector2(u0, v0), new THREE.Vector2(u0, v1), new THREE.Vector2(u1, v1), new THREE.Vector2(u1, v0)]));
      // 穴の奥に、ドアの板・窓のガラスを置く
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(u1 - u0, v1 - v0), flat(o.kind === "door" ? ROOM_COLORS.door.hex : ROOM_COLORS.window.hex));
      panel.position.set((u0 + u1) / 2, (v0 + v1) / 2, -0.04);
      panel.userData.surface = o.kind;
      panels.push(panel);
    }
    const wall = new THREE.Mesh(new THREE.ShapeGeometry(shape), flat(w.normal[0] !== 0 ? ROOM_COLORS.sideWall.hex : ROOM_COLORS.wall.hex));
    wall.userData.surface = "wall";
    // 壁の面の向き:u = a→b、法線(+Z)= 部屋の内側
    const holder = new THREE.Group();
    holder.add(wall, ...panels);
    const ux = (w.b[0] - w.a[0]) / 100 / L;
    const uz = (w.b[1] - w.a[1]) / 100 / L;
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(ux, 0, uz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(w.normal[0], 0, w.normal[1]));
    holder.applyMatrix4(basis);
    holder.position.set(w.a[0] / 100, 0, w.a[1] / 100);
    g.add(holder);
  });
  return g;
}

/** 家具の目安の形(箱の組み合わせ)。家具の中心の床を原点にし、正面を +Z にする */
export function furnitureMesh(f: Furniture): THREE.Group {
  const g = new THREE.Group();
  const m = mat(furnitureColor(f).hex);
  const W = f.widthCm / 100;
  const D = f.depthCm / 100;
  const H = f.heightCm / 100;
  const S = seatHeight(f) / 100;
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.005, w), Math.max(0.005, h), Math.max(0.005, d)), m);
    b.position.set(x, y + h / 2, z);
    g.add(b);
  };
  switch (f.kind) {
    case "bed": {
      // 台 + マットレス + 枕 + 頭の板(頭は -Z)
      const base = Math.max(0.1, S - 0.2);
      box(W, base, D, 0, 0, 0);
      box(W * 0.96, S - base, D * 0.97, 0, base, 0.005);
      box(W * 0.6, 0.12, 0.35, 0, S, -D / 2 + 0.25);
      box(W, H, 0.05, 0, 0, -D / 2 + 0.025);
      break;
    }
    case "desk":
    case "table": {
      const t = 0.035;
      const leg = Math.min(0.05, W / 10);
      box(W, t, D, 0, H - t, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(leg, H - t, leg, sx * (W / 2 - leg / 2), 0, sz * (D / 2 - leg / 2));
      break;
    }
    case "chair": {
      const t = 0.04;
      const leg = 0.035;
      box(W, t, D, 0, S - t, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(leg, S - t, leg, sx * (W / 2 - leg / 2), 0, sz * (D / 2 - leg / 2));
      box(W, H - S, 0.04, 0, S, -D / 2 + 0.02);
      break;
    }
    case "sofa": {
      const arm = Math.min(0.18, W / 8);
      box(W, S, D, 0, 0, 0);
      box(W, H - S, 0.2, 0, S, -D / 2 + 0.1);
      for (const sx of [-1, 1]) box(arm, Math.min(H, S + 0.2) - S, D, sx * (W / 2 - arm / 2), S, 0);
      break;
    }
    case "shelf": {
      // 前が開いた棚(背板・側板・棚板)
      const t = 0.02;
      box(W, H, t, 0, 0, -D / 2 + t / 2);
      for (const sx of [-1, 1]) box(t, H, D, sx * (W / 2 - t / 2), 0, 0);
      const n = Math.max(2, Math.round(H / 0.35));
      for (let i = 0; i <= n; i++) box(W, t, D, 0, Math.min(H - t, (H / n) * i), 0);
      break;
    }
    case "tv": {
      // 画面と台座。床から浮かせる高さ(elevation)の分は外で上げる
      box(W, H * 0.86, D, 0, H * 0.14, 0);
      box(Math.min(W * 0.4, 0.4), H * 0.14, Math.max(D, 0.2), 0, 0, 0);
      break;
    }
    default:
      box(W, H, D, 0, 0, 0);
  }
  g.position.set(f.x / 100, (f.elevationCm ?? 0) / 100, f.z / 100);
  g.rotation.y = rad(f.rotation);
  g.userData.furniture = f.id;
  return g;
}

// ---------------------------------------------------------------- カメラから見える物

export interface Visible {
  id: string;
  /** 見えている割合(目安。0〜1) */
  ratio: number;
}

/**
 * カメラから見える家具。家具の箱の上の点(角・面の真ん中)を写し、画面の中にあって壁や他の家具に隠れていない点の割合を数える。
 * room は buildRoom、furniture は furnitureMesh で作った物(ワールドに置いたもの)
 */
export function visibleFurniture(camera: THREE.Camera, room: THREE.Object3D | null, furniture: THREE.Object3D[]): Visible[] {
  const raycaster = new THREE.Raycaster();
  const blockers = [...(room ? [room] : []), ...furniture];
  const out: Visible[] = [];
  camera.updateMatrixWorld(true);
  const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  for (const obj of furniture) {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) continue;
    // 箱を少し内側に縮めた点(面の上の点が、自分の面に当たって隠れたと数えないように)
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const pts: THREE.Vector3[] = [];
    for (const fx of [-0.45, 0, 0.45]) for (const fy of [0.05, 0.5, 0.95]) for (const fz of [-0.45, 0, 0.45]) pts.push(new THREE.Vector3(c.x + fx * size.x, box.min.y + fy * size.y, c.z + fz * size.z));
    let seen = 0;
    for (const p of pts) {
      const ndc = p.clone().project(camera);
      if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1 || ndc.z < -1 || ndc.z > 1) continue;
      const dir = p.clone().sub(eye);
      const dist = dir.length();
      raycaster.set(eye, dir.normalize());
      raycaster.far = dist;
      // 片面だけの壁・天井は、裏から当たらない(写らない面は隠さない)
      const hit = raycaster.intersectObjects(blockers, true)[0];
      // 何にも当たらないか、最初に当たるのが自分なら見えている(点は箱の中なので、自分の面に当たることが多い)
      if (!hit || belongsTo(hit.object, obj) || hit.distance >= dist - 0.02) seen++;
    }
    const ratio = seen / pts.length;
    if (ratio > 0) out.push({ id: obj.userData.furniture as string, ratio: Math.round(ratio * 100) / 100 });
  }
  return out;
}

function belongsTo(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let x: THREE.Object3D | null = o; x; x = x.parent) if (x === root) return true;
  return false;
}
