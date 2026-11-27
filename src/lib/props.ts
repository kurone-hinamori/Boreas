import * as THREE from "three";

// 小物(バット・剣など)。寸法は実際の大きさ(cm)。3D では型と寸法から目安の形を作る(設計書 5.5.1)。

export const PROP_KINDS = {
  bat: { label: "バット", en: "baseball bat", long: true, size: { lengthCm: 84, widthCm: 6.6, heightCm: 0 } },
  sword: { label: "剣", en: "sword", long: true, size: { lengthCm: 100, widthCm: 5, heightCm: 0 } },
  stick: { label: "棒・杖", en: "stick", long: true, size: { lengthCm: 120, widthCm: 3, heightCm: 0 } },
  cylinder: { label: "円柱", en: "cylinder", long: true, size: { lengthCm: 30, widthCm: 8, heightCm: 0 } },
  ball: { label: "球", en: "ball", long: false, size: { lengthCm: 22, widthCm: 22, heightCm: 0 } },
  box: { label: "箱", en: "box", long: false, size: { lengthCm: 40, widthCm: 30, heightCm: 30 } },
} as const;

export type PropKind = keyof typeof PROP_KINDS;

/** 小物の色(人物の色と重ならない色)。下絵では、この色の物 = この小物、とプロンプトで伝える */
export const PROP_COLORS = [
  { hex: 0x8a4fd0, en: "PURPLE" },
  { hex: 0x22b8c8, en: "CYAN" },
  { hex: 0xe8d020, en: "YELLOW" },
  { hex: 0xe060b0, en: "PINK" },
] as const;

export interface PropShape {
  kind: PropKind;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  /** 手で持つ位置(長い物の、根元からの割合 0〜1) */
  grip: number;
}

/**
 * 小物の 3D の目安。長い物は +Y の向きに伸ばし、持つ位置を原点にする。
 * 置く物(箱・球)は、底を原点にする
 */
export function propMesh(shape: PropShape, color: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1 });
  const L = shape.lengthCm / 100;
  const W = shape.widthCm / 100;
  const H = shape.heightCm / 100;
  const add = (geo: THREE.BufferGeometry, y: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    g.add(m);
    return m;
  };
  const base = -shape.grip * L;
  switch (shape.kind) {
    case "bat": {
      // 先が太い円柱(グリップは太さの 0.4 倍)
      add(new THREE.CylinderGeometry(W / 2, W * 0.2, L, 20), base + L / 2);
      add(new THREE.SphereGeometry(W * 0.28, 12, 8), base);
      break;
    }
    case "sword": {
      const grip = L * 0.22;
      add(new THREE.CylinderGeometry(W * 0.18, W * 0.18, grip, 12), base + grip / 2);
      add(new THREE.BoxGeometry(W * 3.2, W * 0.25, W * 0.5), base + grip);
      const blade = add(new THREE.BoxGeometry(W, L - grip, W * 0.12), base + grip + (L - grip) / 2);
      blade.castShadow = false;
      break;
    }
    case "stick":
    case "cylinder":
      add(new THREE.CylinderGeometry(W / 2, W / 2, L, shape.kind === "stick" ? 14 : 24), base + L / 2);
      break;
    case "ball":
      add(new THREE.SphereGeometry(L / 2, 24, 16), L / 2);
      break;
    case "box": {
      const m = new THREE.Mesh(new THREE.BoxGeometry(L, H, W), mat);
      m.position.y = H / 2;
      g.add(m);
      break;
    }
  }
  return g;
}

/** 人物から見た左右 yaw・上下 pitch(度)を向きにする(+Z が前、+X が左、+Y が上) */
export function dirFromAngles(yaw: number, pitch: number): [number, number, number] {
  const y = THREE.MathUtils.degToRad(yaw);
  const p = THREE.MathUtils.degToRad(pitch);
  return [Math.cos(p) * Math.sin(y), Math.sin(p), Math.cos(p) * Math.cos(y)];
}

// ---------------------------------------------------------------- Euros の装備品(読むだけ)

/** Boreas が使う分だけの Euros の装備品(形は Euros の docs/character-format.md で決まるまでの仮の形) */
export interface EurosEquipment {
  id: string;
  /** 名前。文字列か、日本語と英語 */
  name?: string | { ja?: string; en?: string };
  /** 見た目の説明 */
  description?: { ja?: string; en?: string };
  /** 3D の目安の型(棒・刃物・箱・円柱など) */
  shape?: string;
  /** 寸法(cm) */
  size?: Record<string, unknown>;
  /** デザインの画像 */
  revisions?: { id: string; image?: string }[];
  currentRevision?: string;
  image?: string;
}

/** 型の名前(英語・日本語)→ 小物の型 */
const SHAPE_ALIASES: [RegExp, PropKind][] = [
  [/bat|バット/i, "bat"],
  [/blade|sword|knife|katana|刃|剣|刀|ナイフ/i, "sword"],
  [/rod|stick|staff|pole|spear|棒|杖|槍/i, "stick"],
  [/cylinder|tube|円柱|筒/i, "cylinder"],
  [/ball|sphere|orb|球|玉/i, "ball"],
  [/box|bag|case|cube|箱|鞄|袋/i, "box"],
];

const num = (o: Record<string, unknown> | undefined, ...keys: string[]) => {
  for (const k of keys) {
    const v = o?.[k];
    if (typeof v === "number" && v > 0) return v;
  }
  return undefined;
};

export const equipmentName = (e: EurosEquipment): { ja: string; en: string } =>
  typeof e.name === "string" ? { ja: e.name, en: "" } : { ja: e.name?.ja ?? "", en: e.name?.en ?? "" };

/** 採用中の版のデザインの画像 */
export function equipmentImage(e: EurosEquipment): { revisionId: string | null; image: string } | null {
  const r = e.revisions?.find((x) => x.id === e.currentRevision);
  if (r?.image) return { revisionId: r.id, image: r.image };
  return e.image ? { revisionId: null, image: e.image } : null;
}

/** 装備品の型と寸法(cm)を、小物の形にする。型がなければ名前と説明、それもなければ寸法の比から決める。寸法がなければ型の初期値 */
export function equipmentShape(e: EurosEquipment): { kind: PropKind; lengthCm: number; widthCm: number; heightCm: number } {
  const size = e.size as Record<string, unknown> | undefined;
  const length = num(size, "lengthCm", "length", "heightCm", "height");
  const width = num(size, "widthCm", "width", "diameterCm", "diameter", "thicknessCm", "thickness");
  const thick = num(size, "thicknessCm", "thickness", "depthCm", "depth");
  // 型がなければ、名前と説明から決める(いまの Euros の装備品は型を持たない)
  const text = `${equipmentName(e).ja} ${equipmentName(e).en} ${e.description?.en ?? ""} ${e.description?.ja ?? ""}`;
  let kind = SHAPE_ALIASES.find(([re]) => re.test(e.shape ?? ""))?.[1] ?? SHAPE_ALIASES.find(([re]) => re.test(text))?.[1];
  if (!kind) kind = length && width && length > width * 2.5 ? "stick" : "box";
  const d = PROP_KINDS[kind].size;
  if (kind === "box") return { kind, lengthCm: num(size, "widthCm", "width") ?? d.lengthCm, widthCm: thick ?? d.widthCm, heightCm: num(size, "heightCm", "height", "lengthCm", "length") ?? d.heightCm };
  if (kind === "ball") {
    const dia = num(size, "diameterCm", "diameter", "widthCm", "width", "lengthCm", "length") ?? d.lengthCm;
    return { kind, lengthCm: dia, widthCm: dia, heightCm: 0 };
  }
  return { kind, lengthCm: length ?? d.lengthCm, widthCm: width ?? d.widthCm, heightCm: 0 };
}
