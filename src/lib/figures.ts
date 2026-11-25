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
