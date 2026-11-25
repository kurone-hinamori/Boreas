import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { type PoseId, POSES } from "./poses";

/** 人物の素体の種類。public/figures/<id>.glb(tools/make_figure.py で作る) */
export const FIGURES = [
  { id: "female_slim", label: "女性・細身" },
  { id: "female_standard", label: "女性・標準" },
  { id: "female_stocky", label: "女性・がっしり" },
  { id: "male_slim", label: "男性・細身" },
  { id: "male_standard", label: "男性・標準" },
  { id: "male_stocky", label: "男性・がっしり" },
] as const;

export type FigureId = (typeof FIGURES)[number]["id"];

/** 人物の色。下絵では、この色の素体 = 何番目の人物、とプロンプトで伝える */
export const PERSON_COLORS = [
  { hex: 0xe04848, en: "RED" },
  { hex: 0x4870e0, en: "BLUE" },
  { hex: 0x48b060, en: "GREEN" },
  { hex: 0xe0a030, en: "ORANGE" },
] as const;

/** 人物から見た向き:+Z が前、+X が人物の左、+Y が上 */
export type Dir = [number, number, number];

/** 関節をつかんで動かせる手足の先。骨の鎖(付け根 → 関節 → 先)と、関節が曲がる向き */
export const LIMBS = {
  hand_l: { bones: ["upperarm_l", "lowerarm_l", "hand_l"], pole: [0.2, -0.3, -1] as Dir, label: "左手" },
  hand_r: { bones: ["upperarm_r", "lowerarm_r", "hand_r"], pole: [-0.2, -0.3, -1] as Dir, label: "右手" },
  foot_l: { bones: ["thigh_l", "calf_l", "foot_l"], pole: [0, 0, 1] as Dir, label: "左足" },
  foot_r: { bones: ["thigh_r", "calf_r", "foot_r"], pole: [0, 0, 1] as Dir, label: "右足" },
} as const;

export type LimbId = keyof typeof LIMBS;

/** 手の形 */
export const HAND_SHAPES = [
  { id: "auto", label: "ポーズのまま" },
  { id: "open", label: "開く" },
  { id: "relaxed", label: "軽く曲げる" },
  { id: "fist", label: "握る" },
  { id: "point", label: "指差す" },
  { id: "peace", label: "ピース" },
] as const;

export type HandShape = (typeof HAND_SHAPES)[number]["id"];

/** 触れる点に使う体の部位と、その骨 */
export const BODY_PARTS = {
  head: { bone: "head", label: "頭", en: "head" },
  chest: { bone: "spine_03", label: "胸", en: "chest" },
  waist: { bone: "pelvis", label: "腰", en: "waist" },
  shoulder_l: { bone: "upperarm_l", label: "左肩", en: "left shoulder" },
  shoulder_r: { bone: "upperarm_r", label: "右肩", en: "right shoulder" },
  hand_l: { bone: "hand_l", label: "左手", en: "left hand" },
  hand_r: { bone: "hand_r", label: "右手", en: "right hand" },
} as const;

export type BodyPart = keyof typeof BODY_PARTS;

const loader = new GLTFLoader();
const cache = new Map<FigureId, Promise<THREE.Group>>();

function loadModel(id: FigureId): Promise<THREE.Group> {
  let p = cache.get(id);
  if (!p) {
    p = loader.loadAsync(`/figures/${id}.glb`).then((g) => g.scene);
    cache.set(id, p);
  }
  return p.then((g) => cloneSkinned(g));
}

/** 骨格つきのモデルを複製する(同じ素体を2人に使っても、ポーズが互いに影響しないように) */
function cloneSkinned(source: THREE.Group): THREE.Group {
  const clone = source.clone(true);
  const bones = new Map<string, THREE.Bone>();
  clone.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
  });
  clone.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const skeleton = new THREE.Skeleton(
      mesh.skeleton.bones.map((b) => bones.get(b.name)!),
      mesh.skeleton.boneInverses.map((m) => m.clone()),
    );
    mesh.bind(skeleton, mesh.bindMatrix.clone());
  });
  return clone;
}

/** 場面に置いた素体1体。root の位置と向きが、場面での立ち位置になる */
export class Figure {
  readonly root = new THREE.Group();
  private model!: THREE.Group;
  private bones: Record<string, THREE.Bone> = {};
  private rest: Record<string, THREE.Quaternion> = {};
  private material = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 });
  private baseHeight = 1;

  static async load(id: FigureId): Promise<Figure> {
    const f = new Figure();
    f.model = await loadModel(id);
    f.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.material = f.material;
        // 骨を動かすと元の範囲の外に出るので、画面の外と判定されて消えないようにする
        mesh.frustumCulled = false;
      }
      if ((o as THREE.Bone).isBone) f.bones[o.name] = o as THREE.Bone;
    });
    f.root.add(f.model);
    f.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(f.model);
    f.baseHeight = box.max.y - box.min.y;
    f.rest = Object.fromEntries(Object.entries(f.bones).map(([k, b]) => [k, b.quaternion.clone()]));
    return f;
  }

  setColor(hex: number) {
    this.material.color.setHex(hex);
  }

  /** 身長(m)。素体を拡大・縮小して合わせる */
  setHeight(m: number) {
    this.model.scale.setScalar(m / this.baseHeight);
  }

  get height(): number {
    return this.model.scale.x * this.baseHeight;
  }

  reset() {
    for (const [k, q] of Object.entries(this.rest)) this.bones[k].quaternion.copy(q);
    this.model.position.y = 0;
  }

  /** 骨 name を、子の骨 child へ向かう向きが dir になるよう回す */
  aim(name: string, child: string, dir: Dir) {
    const b = this.bones[name];
    const c = this.bones[child];
    if (!b || !c) return;
    this.root.updateMatrixWorld(true);
    const p = b.getWorldPosition(new THREE.Vector3());
    const cur = c.getWorldPosition(new THREE.Vector3()).sub(p).normalize();
    const want = new THREE.Vector3(...dir).normalize().applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()));
    this.rotateWorld(b, new THREE.Quaternion().setFromUnitVectors(cur, want));
  }

  /** 骨 name を、人物から見た軸 axis のまわりに deg 度回す */
  turn(name: string, axis: Dir, deg: number) {
    const b = this.bones[name];
    if (!b) return;
    this.root.updateMatrixWorld(true);
    const ax = new THREE.Vector3(...axis).normalize().applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()));
    this.rotateWorld(b, new THREE.Quaternion().setFromAxisAngle(ax, THREE.MathUtils.degToRad(deg)));
  }

  /** 指を曲げる(握るほど大きく)。side は "l" か "r" */
  curl(side: "l" | "r", deg: number) {
    for (const f of ["index", "middle", "ring", "pinky"]) {
      for (const i of [1, 2, 3]) this.bones[`${f}_0${i}_${side}`]?.rotateZ(THREE.MathUtils.degToRad(deg));
    }
    for (const i of [2, 3]) this.bones[`thumb_0${i}_${side}`]?.rotateZ(THREE.MathUtils.degToRad(deg * 0.6));
  }

  /** 指を1本だけ曲げる(負の値で伸ばす)。curl のあとに使う */
  finger(side: "l" | "r", name: "index" | "middle" | "ring" | "pinky", deg: number) {
    for (const i of [1, 2, 3]) this.bones[`${name}_0${i}_${side}`]?.rotateZ(THREE.MathUtils.degToRad(deg));
  }

  /** 腰を下げる(座る・しゃがむ)。身長に対する割合 */
  lower(ratio: number) {
    this.model.position.y = -ratio * this.height;
  }

  /** 骨のワールドでの位置(手に物を持たせる・視線を向けるときに使う) */
  bonePosition(name: string): THREE.Vector3 | null {
    const b = this.bones[name];
    if (!b) return null;
    this.root.updateMatrixWorld(true);
    return b.getWorldPosition(new THREE.Vector3());
  }

  /** 素体のメッシュ(クリックで人物を選ぶときに使う) */
  get meshes(): THREE.Object3D[] {
    const list: THREE.Object3D[] = [];
    this.model.traverse((o) => (o as THREE.Mesh).isMesh && list.push(o));
    return list;
  }

  /** 骨 name を、子の骨 child へ向かう向きが、ワールドの向き want になるよう回す */
  private aimWorld(name: string, child: string, want: THREE.Vector3) {
    const b = this.bones[name];
    const c = this.bones[child];
    if (!b || !c || want.lengthSq() < 1e-10) return;
    this.root.updateMatrixWorld(true);
    const p = b.getWorldPosition(new THREE.Vector3());
    const cur = c.getWorldPosition(new THREE.Vector3()).sub(p).normalize();
    this.rotateWorld(b, new THREE.Quaternion().setFromUnitVectors(cur, want.clone().normalize()));
  }

  /**
   * 手足の先を target(ワールドの位置)に届かせる(2本の骨の IK)。
   * 関節は LIMBS の pole の向きに曲げる。届かないときは、その向きにいっぱいに伸ばす
   */
  reach(limb: LimbId, target: THREE.Vector3) {
    const [rootName, midName, endName] = LIMBS[limb].bones;
    const S = this.bonePosition(rootName)!;
    const E = this.bonePosition(midName)!;
    const H = this.bonePosition(endName)!;
    const a = S.distanceTo(E);
    const b = E.distanceTo(H);
    const toT = target.clone().sub(S);
    const d = Math.min(Math.max(toT.length(), Math.abs(a - b) + 1e-4), a + b - 1e-4);
    const u = toT.normalize();
    const pole = new THREE.Vector3(...LIMBS[limb].pole).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()));
    const v = pole.sub(u.clone().multiplyScalar(pole.dot(u)));
    if (v.lengthSq() < 1e-8) v.set(0, -1, 0).sub(u.clone().multiplyScalar(-u.y));
    v.normalize();
    const cos = (a * a + d * d - b * b) / (2 * a * d);
    const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
    const elbow = S.clone().add(u.clone().multiplyScalar(a * cos)).add(v.multiplyScalar(a * sin));
    const end = S.clone().add(u.clone().multiplyScalar(d));
    this.aimWorld(rootName, midName, elbow.clone().sub(S));
    this.aimWorld(midName, endName, end.sub(this.bonePosition(midName)!));
  }

  /** 指を伸ばした形に戻す */
  private resetFingers(side: "l" | "r") {
    for (const [k, q] of Object.entries(this.rest)) {
      if (k.endsWith(`_${side}`) && /^(index|middle|ring|pinky|thumb)_0[123]_/.test(k)) this.bones[k].quaternion.copy(q);
    }
  }

  /** 手の形を決める("auto" はポーズのまま) */
  handShape(side: "l" | "r", shape: HandShape) {
    if (shape === "auto") return;
    this.resetFingers(side);
    if (shape === "open") return;
    if (shape === "relaxed") return this.curl(side, 25);
    this.curl(side, 85);
    if (shape === "point") this.finger(side, "index", -85);
    if (shape === "peace") {
      this.finger(side, "index", -85);
      this.finger(side, "middle", -85);
    }
  }

  /** 首と頭を target(ワールドの位置)に向ける。角度は、人物の体の向きからの左右と上下(度)で返す */
  gazeAngles(target: THREE.Vector3): { yaw: number; pitch: number } {
    const head = this.bonePosition("head")!;
    this.root.updateMatrixWorld(true);
    const inv = this.root.matrixWorld.clone().invert();
    const d = target.clone().applyMatrix4(inv).sub(head.clone().applyMatrix4(inv));
    const yaw = THREE.MathUtils.radToDeg(Math.atan2(d.x, d.z));
    const pitch = -THREE.MathUtils.radToDeg(Math.atan2(d.y, Math.hypot(d.x, d.z)));
    const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
    return { yaw: clamp(yaw, 75), pitch: clamp(pitch, 45) };
  }

  /** 首と頭を、左右 yaw・上下 pitch(度。+ で人物の左・下)に向ける */
  turnHead(yaw: number, pitch: number) {
    this.turn("neck_01", [0, 1, 0], yaw * 0.4);
    this.turn("head", [0, 1, 0], yaw * 0.6);
    this.turn("neck_01", [1, 0, 0], pitch * 0.4);
    this.turn("head", [1, 0, 0], pitch * 0.6);
  }

  /** 人物の座標(root から見た位置)とワールドの位置を変換する */
  toLocal(world: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return this.root.worldToLocal(world.clone());
  }

  toWorld(local: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return this.root.localToWorld(local.clone());
  }

  /** 人物から見た向き dir を、ワールドの向きにする */
  dirToWorld(dir: Dir): THREE.Vector3 {
    return new THREE.Vector3(...dir).normalize().applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()));
  }

  pose(id: PoseId) {
    this.reset();
    (POSES.find((p) => p.id === id) ?? POSES[0]).apply(this);
    this.root.updateMatrixWorld(true);
  }

  private rotateWorld(b: THREE.Bone, delta: THREE.Quaternion) {
    const world = b.getWorldQuaternion(new THREE.Quaternion());
    const parent = b.parent!.getWorldQuaternion(new THREE.Quaternion());
    b.quaternion.copy(parent.invert().multiply(delta.multiply(world)));
  }

  dispose() {
    this.material.dispose();
    this.root.removeFromParent();
  }
}
