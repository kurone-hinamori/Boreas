import * as THREE from "three";

// 人ではない登場人物(設計書 5.3)。3D は形・大きさ・向き・ポーズの目安だけで、見た目は Euros のシートで決める。
// 大きさはメートル。向きは人物と同じく、+Z が前、+X が左、+Y が上。

/** 形の種類と、大きさの項目(m)の初期値 */
export const CREATURE_FORMS = {
  sphere: { label: "球", en: "a round sphere", size: { diameter: 0.4 } },
  blob: { label: "不定形", en: "a soft amorphous blob", size: { width: 1.2, depth: 1.0, height: 0.7 } },
  quadruped: { label: "四足", en: "a four-legged creature", size: { length: 1.0, height: 0.6 } },
  biped: { label: "二足の怪物", en: "a huge two-legged monster", size: { height: 3.0, width: 1.4 } },
  object: { label: "物", en: "a solid object", size: { width: 0.6, depth: 0.6, height: 1.2 } },
} as const;

export type CreatureForm = keyof typeof CREATURE_FORMS;

/** 大きさの項目の名前(画面と、プロンプトの英語) */
export const SIZE_LABELS: Record<string, { label: string; en: string }> = {
  diameter: { label: "直径", en: "in diameter" },
  width: { label: "幅", en: "wide" },
  depth: { label: "奥行き", en: "deep" },
  height: { label: "高さ", en: "tall" },
  length: { label: "体長", en: "long" },
};

/** 形の種類ごとの大きさの項目の意味(四足の height は体高、二足の width は体の太さ) */
export function sizeLabel(form: CreatureForm, key: string): string {
  if (form === "quadruped" && key === "height") return "体高";
  if (form === "biped" && key === "height") return "身長";
  if (form === "biped" && key === "width") return "体の太さ(肩幅)";
  return SIZE_LABELS[key]?.label ?? key;
}

/** 体の形(Euros の body と同じ形:{ form: "sphere", size: { diameter: 0.4 } }) */
export interface CreatureBody {
  form: CreatureForm;
  /** 大きさ(m)。項目は CREATURE_FORMS の size */
  size: Record<string, number>;
  /** 腕・尾があるか(二足の怪物は腕、四足と二足は尾。ないときは「ある」) */
  arms?: boolean;
  tail?: boolean;
}

/** 脚の構え(四足・二足) */
export const STANCES = [
  { id: "stand", label: "立つ", en: "standing" },
  { id: "walk", label: "歩く", en: "walking" },
  { id: "crouch", label: "身を低くする", en: "crouching low" },
  { id: "leap", label: "飛びかかる", en: "leaping forward" },
] as const;

export type Stance = (typeof STANCES)[number]["id"];

/** 骨格つきの形(四足・二足)の動かせるところ。角度は度 */
export interface CreatureJoints {
  /** 首(+ で左・下) */
  neckYaw: number;
  neckPitch: number;
  /** 尾の上下(+ で上) */
  tail: number;
  /** 口の開き(0〜1) */
  mouth: number;
  /** 腕を前に上げる角度(0 で下ろす、90 で前、180 で真上) */
  armL: number;
  armR: number;
  /** 体を前に倒す角度 */
  lean: number;
  stance: Stance;
}

export const DEFAULT_JOINTS: CreatureJoints = { neckYaw: 0, neckPitch: 0, tail: 0, mouth: 0, armL: 20, armR: 20, lean: 0, stance: "stand" };

/** 触れる点に使う部位。形の種類ごとに使える部位が違う */
export const CREATURE_PARTS = {
  top: { label: "上(頭)", en: "top" },
  front: { label: "正面", en: "front" },
  back: { label: "背中", en: "back" },
  side_l: { label: "左の横", en: "left side" },
  side_r: { label: "右の横", en: "right side" },
  bottom: { label: "下", en: "underside" },
  head: { label: "頭", en: "head" },
  chest: { label: "胸", en: "chest" },
  belly: { label: "腹", en: "belly" },
  shoulder_l: { label: "左肩", en: "left shoulder" },
  shoulder_r: { label: "右肩", en: "right shoulder" },
  hand_l: { label: "左手", en: "left hand" },
  hand_r: { label: "右手", en: "right hand" },
  tail: { label: "尾", en: "tail" },
} as const;

export type CreaturePart = keyof typeof CREATURE_PARTS;

/** 形の種類で使える部位(へこみは、shell の部位だけに付けられる) */
export function partsOf(body: CreatureBody): CreaturePart[] {
  switch (body.form) {
    case "sphere":
      return ["top", "front", "back", "side_l", "side_r", "bottom"];
    case "blob":
    case "object":
      return ["top", "front", "back", "side_l", "side_r"];
    case "quadruped":
      return ["head", "back", "chest", ...(body.tail !== false ? (["tail"] as const) : [])];
    case "biped":
      return ["head", "chest", "belly", "shoulder_l", "shoulder_r", ...(body.arms !== false ? (["hand_l", "hand_r"] as const) : []), ...(body.tail !== false ? (["tail"] as const) : [])];
  }
}

/** 誇張(場面だけで大きさを変える倍率)。長さは縦(高さ・体長)、太さは横の倍率 */
export interface Exaggeration {
  all: number;
  length: number;
  width: number;
}

export const NO_EXAGGERATION: Exaggeration = { all: 1, length: 1, width: 1 };

export const isExaggerated = (s: Exaggeration | undefined) => !!s && (s.all !== 1 || s.length !== 1 || s.width !== 1);

export interface StageCreature {
  body: CreatureBody;
  /** 位置(m)と向き(度) */
  x: number;
  z: number;
  rotation: number;
  /** 色の番号(PERSON_COLORS。人物と同じ色の並びを使い、同じ色は使わない) */
  color: number;
  /** 球:浮く高さ(m)と傾き(度。前後・左右) */
  lift: number;
  tilt: number;
  roll: number;
  /** 不定形:つぶれ(+)・伸び(-)。-0.5〜0.6 */
  squash: number;
  /** 不定形:へこみの位置と深さ(高さや幅に対する割合) */
  dent: { part: CreaturePart; depth: number } | null;
  /** 四足・二足 */
  joints: CreatureJoints;
  scale?: Exaggeration;
}

/** 実際の大きさに誇張を掛けた大きさ(m)。長さは縦(高さ・体長・直径)、太さは横 */
export function exaggeratedSize(body: CreatureBody, s: Exaggeration = NO_EXAGGERATION): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(body.size)) {
    const along = k === "height" || k === "length" || k === "diameter";
    out[k] = v * s.all * (along ? s.length : s.width);
  }
  return out;
}

/** 大きさの値(足りない項目は形の種類の初期値) */
export function sizeOf(body: CreatureBody, key: string): number {
  const v = body.size[key];
  const d = (CREATURE_FORMS[body.form].size as Record<string, number>)[key];
  return typeof v === "number" && v > 0 ? v : d;
}

/** 立てたときのいちばん上の高さ(m)。カメラを合わせるときに使う */
export function creatureTop(c: StageCreature): number {
  const s = c.scale ?? NO_EXAGGERATION;
  const b = c.body;
  const k = s.all * s.length;
  switch (b.form) {
    case "sphere":
      return c.lift + sizeOf(b, "diameter") * k;
    case "blob":
      return sizeOf(b, "height") * (1 - c.squash) * k;
    case "quadruped":
      return sizeOf(b, "height") * 1.45 * k;
    case "biped":
    case "object":
      return sizeOf(b, "height") * k;
  }
}

// ---------------------------------------------------------------- 3D の目安

/** 作った形。points は部位の位置(ワールド)、look は視線を向ける位置 */
export interface BuiltCreature {
  root: THREE.Group;
  meshes: THREE.Mesh[];
  points: Partial<Record<CreaturePart, THREE.Vector3>>;
  look: THREE.Vector3;
}

const deg = THREE.MathUtils.degToRad;

/** 不定形の縦の断面(わらび餅のような、底の平らな丸い塊)。y は 0〜1、r は 0〜1 */
const BLOB_FLAT = 0.15;
const BLOB_EXP = 0.6;
function blobProfile(): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 32; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 32;
    const r = Math.pow(Math.abs(Math.cos(a)), BLOB_EXP);
    const y = (Math.sin(a) * (a < 0 ? BLOB_FLAT : 1) + BLOB_FLAT) / (1 + BLOB_FLAT);
    pts.push(new THREE.Vector2(Math.max(r, 1e-4), y));
  }
  return pts;
}

/** 断面の、高さ y(0〜1)での半径(0〜1) */
function blobRadiusAt(y: number): number {
  const s = Math.min(1, Math.max(-1, y * (1 + BLOB_FLAT) - BLOB_FLAT));
  const a = s >= 0 ? Math.asin(s) : Math.asin(Math.max(-1, s / BLOB_FLAT));
  return Math.pow(Math.abs(Math.cos(a)), BLOB_EXP);
}

/** 部位の位置を覚えておく印(見えない) */
function anchor(parent: THREE.Object3D, name: string, x: number, y: number, z: number) {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

/** 根元(原点)から -Y に伸びる円柱。脚・腕・尾に使う */
function limb(mat: THREE.Material, length: number, r0: number, r1: number) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, length, 14), mat);
  m.position.y = -length / 2;
  return m;
}

/** 2本の骨の脚。upper と lower は、前に振る角度(度) */
function leg(parent: THREE.Object3D, mat: THREE.Material, at: THREE.Vector3, len: number, r: number, upper: number, lower: number, foot?: string) {
  const hip = new THREE.Group();
  hip.position.copy(at);
  hip.rotation.x = -deg(upper);
  hip.add(limb(mat, len / 2, r, r * 0.8));
  const knee = new THREE.Group();
  knee.position.y = -len / 2;
  knee.rotation.x = -deg(lower);
  knee.add(limb(mat, len / 2, r * 0.8, r * 0.6));
  const sole = new THREE.Mesh(new THREE.SphereGeometry(r * 0.75, 12, 8), mat);
  sole.position.y = -len / 2;
  knee.add(sole);
  if (foot) anchor(knee, foot, 0, -len / 2, 0);
  hip.add(knee);
  parent.add(hip);
}

/** 2本の骨の脚の、腰から足までの縦の長さを h にする角度(膝を曲げる) */
function bend(len: number, h: number): number {
  return THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.max(0.05, h / len))));
}

/**
 * 人ではない登場人物の 3D の目安を作る。
 * root(位置・向き)→ 浮く高さ → 誇張の倍率 → 実際の大きさの形、の順に重ねる
 */
export function buildCreature(c: StageCreature, color: number): BuiltCreature {
  const root = new THREE.Group();
  root.position.set(c.x, 0, c.z);
  root.rotation.y = deg(c.rotation);
  const lifted = new THREE.Group();
  root.add(lifted);
  const s = c.scale ?? NO_EXAGGERATION;
  const scaled = new THREE.Group();
  scaled.scale.set(s.all * s.width, s.all * s.length, s.all * s.width);
  lifted.add(scaled);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 });
  // 正面の印(目・レンズ・口)。同じ色を暗くして、清書で黒い点にならないようにする
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.55), roughness: 0.4 });
  const b = c.body;
  const j = { ...DEFAULT_JOINTS, ...c.joints };
  let look = anchor(scaled, "look", 0, 0, 0);

  switch (b.form) {
    case "sphere": {
      const r = sizeOf(b, "diameter") / 2;
      lifted.position.y = c.lift;
      const ball = new THREE.Group();
      ball.position.y = r;
      ball.rotation.set(deg(c.tilt), 0, deg(c.roll));
      ball.add(new THREE.Mesh(new THREE.SphereGeometry(r, 40, 28), mat));
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.22, r * 0.22, r * 0.08, 24), dark);
      lens.rotation.x = Math.PI / 2;
      lens.position.z = r * 0.98;
      ball.add(lens);
      anchor(ball, "top", 0, r, 0);
      anchor(ball, "bottom", 0, -r, 0);
      anchor(ball, "front", 0, 0, r);
      anchor(ball, "back", 0, 0, -r);
      anchor(ball, "side_l", r, 0, 0);
      anchor(ball, "side_r", -r, 0, 0);
      look = anchor(ball, "look", 0, 0, r);
      scaled.add(ball);
      break;
    }
    case "blob": {
      // つぶれると低く広く、伸びると高く細くなる(体積はおよそ同じ)
      const h = sizeOf(b, "height") * (1 - c.squash);
      const k = 1 / Math.sqrt(Math.max(0.2, 1 - c.squash));
      const w = sizeOf(b, "width") * k;
      const d = sizeOf(b, "depth") * k;
      const geo = new THREE.LatheGeometry(blobProfile(), 48);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) pos.setXYZ(i, (pos.getX(i) * w) / 2, pos.getY(i) * h, (pos.getZ(i) * d) / 2);
      // 部位の位置(表面)。横は高さの 0.4 のあたり
      const sideY = 0.4;
      const rs = blobRadiusAt(sideY);
      const surface: Record<string, THREE.Vector3> = {
        top: new THREE.Vector3(0, h, 0),
        front: new THREE.Vector3(0, sideY * h, (rs * d) / 2),
        back: new THREE.Vector3(0, sideY * h, (-rs * d) / 2),
        side_l: new THREE.Vector3((rs * w) / 2, sideY * h, 0),
        side_r: new THREE.Vector3((-rs * w) / 2, sideY * h, 0),
      };
      if (c.dent && surface[c.dent.part] && c.dent.depth > 0) {
        // へこみ:中心へ向かって押し込む。へこみの深さは、押す向きの大きさに対する割合
        const p = surface[c.dent.part];
        const center = new THREE.Vector3(0, c.dent.part === "top" ? 0 : sideY * h, 0);
        const inward = center.clone().sub(p).normalize();
        const extent = c.dent.part === "top" ? h : c.dent.part === "front" || c.dent.part === "back" ? d : w;
        const amount = c.dent.depth * extent;
        const radius = 0.32 * Math.max(w, d, h);
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          const f = Math.exp(-(v.distanceToSquared(p) / (radius * radius)) * 2.2);
          v.addScaledVector(inward, amount * f);
          if (v.y < 0) v.y = 0;
          pos.setXYZ(i, v.x, v.y, v.z);
        }
        p.addScaledVector(inward, amount);
      }
      geo.computeVertexNormals();
      scaled.add(new THREE.Mesh(geo, mat));
      for (const [k2, p] of Object.entries(surface)) anchor(scaled, k2, p.x, p.y, p.z);
      look = anchor(scaled, "look", 0, h * 0.6, (rs * d) / 2);
      break;
    }
    case "object": {
      const w = sizeOf(b, "width");
      const d = sizeOf(b, "depth");
      const h = sizeOf(b, "height");
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      box.position.y = h / 2;
      scaled.add(box);
      anchor(scaled, "top", 0, h, 0);
      anchor(scaled, "front", 0, h / 2, d / 2);
      anchor(scaled, "back", 0, h / 2, -d / 2);
      anchor(scaled, "side_l", w / 2, h / 2, 0);
      anchor(scaled, "side_r", -w / 2, h / 2, 0);
      look = anchor(scaled, "look", 0, h * 0.75, d / 2);
      break;
    }
    case "quadruped": {
      const L = sizeOf(b, "length");
      const H = sizeOf(b, "height");
      const rT = Math.min(0.16 * L, 0.32 * H);
      const legLen = Math.max(0.05, H - rT);
      // 脚の構え:前脚・後脚の、上と下の角度と、胴の高さ
      let hipH = legLen;
      let front: [number, number] = [0, 0];
      let rear: [number, number] = [0, 0];
      let pitch = 0;
      if (j.stance === "walk") {
        front = [18, -6];
        rear = [-18, 10];
      } else if (j.stance === "crouch") {
        hipH = legLen * 0.55;
        const a = bend(legLen, hipH);
        front = [-a, 2 * a];
        rear = [a, -2 * a];
      } else if (j.stance === "leap") {
        hipH = legLen * 1.05;
        front = [70, -30];
        rear = [-55, 20];
        pitch = -12;
      }
      const body = new THREE.Group();
      body.position.y = hipH + rT * 0.5;
      body.rotation.x = deg(pitch + j.lean);
      scaled.add(body);
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(rT, 0.6 * L - 2 * rT > 0 ? 0.6 * L - 2 * rT : 0.01, 8, 18), mat);
      torso.rotation.x = Math.PI / 2;
      body.add(torso);
      anchor(body, "back", 0, rT, -0.05 * L);
      anchor(body, "chest", 0, -0.2 * rT, 0.3 * L + rT * 0.2);
      const r = rT * 0.32;
      for (const [x, z, a, name] of [
        [rT * 0.6, 0.24 * L, front, "fl"],
        [-rT * 0.6, 0.24 * L, front, "fr"],
        [rT * 0.6, -0.24 * L, rear, "rl"],
        [-rT * 0.6, -0.24 * L, rear, "rr"],
      ] as [number, number, [number, number], string][]) {
        // 歩くときは、左右で前後を入れ替える
        const flip = j.stance === "walk" && (name === "fr" || name === "rl") ? -1 : 1;
        leg(body, mat, new THREE.Vector3(x, -rT * 0.5, z), legLen, r, a[0] * flip, a[1] * flip);
      }
      // 首と頭
      const neck = new THREE.Group();
      neck.position.set(0, rT * 0.4, 0.3 * L);
      neck.rotation.set(deg(-45 + j.neckPitch), deg(j.neckYaw), 0, "YXZ");
      const neckLen = 0.28 * L;
      const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(rT * 0.45, rT * 0.6, neckLen, 14), mat);
      neckMesh.rotation.x = Math.PI / 2;
      neckMesh.position.z = neckLen / 2;
      neck.add(neckMesh);
      const head = new THREE.Group();
      head.position.z = neckLen;
      // 頭は水平に戻す
      head.rotation.x = deg(45);
      const hr = Math.max(rT * 0.75, 0.07 * L);
      head.add(new THREE.Mesh(new THREE.SphereGeometry(hr, 20, 14), mat));
      const snout = new THREE.Mesh(new THREE.BoxGeometry(hr * 0.9, hr * 0.55, hr * 1.2), mat);
      snout.position.set(0, -hr * 0.1, hr * 1.0);
      head.add(snout);
      const jaw = new THREE.Group();
      jaw.position.set(0, -hr * 0.4, hr * 0.4);
      jaw.rotation.x = deg(j.mouth * 40);
      const jawMesh = new THREE.Mesh(new THREE.BoxGeometry(hr * 0.8, hr * 0.2, hr * 1.1), dark);
      jawMesh.position.z = hr * 0.55;
      jaw.add(jawMesh);
      head.add(jaw);
      anchor(head, "head", 0, hr, 0);
      look = anchor(head, "look", 0, 0, hr * 1.6);
      neck.add(head);
      body.add(neck);
      if (b.tail !== false) {
        const tail = new THREE.Group();
        tail.position.set(0, rT * 0.3, -0.3 * L);
        tail.rotation.x = deg(60 + j.tail);
        tail.add(limb(mat, 0.4 * L, rT * 0.25, rT * 0.08));
        anchor(tail, "tail", 0, -0.38 * L, 0);
        body.add(tail);
      }
      break;
    }
    case "biped": {
      const H = sizeOf(b, "height");
      const W = sizeOf(b, "width");
      const legLen = 0.4 * H;
      let hipH = legLen;
      let l: [number, number] = [0, 0];
      let r: [number, number] = [0, 0];
      if (j.stance === "walk" || j.stance === "leap") {
        l = [22, -10];
        r = [-18, 14];
      } else if (j.stance === "crouch") {
        hipH = legLen * 0.7;
        const a = bend(legLen, hipH);
        l = r = [a, -2 * a];
      }
      const pelvis = new THREE.Group();
      pelvis.position.y = hipH;
      scaled.add(pelvis);
      for (const [x, a] of [
        [W * 0.25, l],
        [-W * 0.25, r],
      ] as [number, [number, number]][])
        leg(pelvis, mat, new THREE.Vector3(x, 0, 0), legLen, W * 0.13, a[0], a[1]);
      const torso = new THREE.Group();
      torso.rotation.x = deg(j.lean);
      pelvis.add(torso);
      const tH = 0.4 * H;
      const chest = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), mat);
      chest.scale.set(W / 2, tH / 2 + 0.04 * H, W * 0.36);
      chest.position.y = tH / 2;
      torso.add(chest);
      anchor(torso, "chest", 0, tH * 0.7, W * 0.33);
      anchor(torso, "belly", 0, tH * 0.3, W * 0.36);
      const shoulderY = tH * 0.85;
      for (const side of ["l", "r"] as const) {
        const x = (side === "l" ? 1 : -1) * W * 0.5;
        anchor(torso, `shoulder_${side}`, x, shoulderY, 0);
        if (b.arms === false) continue;
        const arm = new THREE.Group();
        arm.position.set(x, shoulderY, 0);
        arm.rotation.set(-deg(side === "l" ? j.armL : j.armR), 0, deg(side === "l" ? 12 : -12));
        const armLen = 0.36 * H;
        arm.add(limb(mat, armLen * 0.5, W * 0.1, W * 0.085));
        const elbow = new THREE.Group();
        elbow.position.y = -armLen * 0.5;
        elbow.rotation.x = -deg(20);
        elbow.add(limb(mat, armLen * 0.5, W * 0.085, W * 0.07));
        const hand = new THREE.Mesh(new THREE.SphereGeometry(W * 0.1, 14, 10), mat);
        hand.position.y = -armLen * 0.5;
        elbow.add(hand);
        anchor(elbow, `hand_${side}`, 0, -armLen * 0.5, 0);
        arm.add(elbow);
        torso.add(arm);
      }
      const neck = new THREE.Group();
      neck.position.y = tH * 0.95;
      neck.rotation.set(deg(j.neckPitch), deg(j.neckYaw), 0, "YXZ");
      torso.add(neck);
      const hr = 0.075 * H;
      const head = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mat);
      head.scale.set(hr, hr, hr * 1.1);
      head.position.set(0, 0.06 * H + hr * 0.6, hr * 0.3);
      neck.add(head, new THREE.Mesh(new THREE.CylinderGeometry(W * 0.18, W * 0.24, 0.08 * H, 14), mat));
      const jaw = new THREE.Group();
      jaw.position.set(0, 0.06 * H + hr * 0.1, hr * 0.6);
      jaw.rotation.x = deg(j.mouth * 35);
      const jawMesh = new THREE.Mesh(new THREE.BoxGeometry(hr * 1.2, hr * 0.3, hr * 1.4), dark);
      jawMesh.position.z = hr * 0.6;
      jaw.add(jawMesh);
      neck.add(jaw);
      anchor(neck, "head", 0, 0.06 * H + hr * 1.6, hr * 0.3);
      look = anchor(neck, "look", 0, 0.06 * H + hr * 0.6, hr * 1.4);
      if (b.tail !== false) {
        const tail = new THREE.Group();
        tail.position.set(0, tH * 0.05, -W * 0.3);
        tail.rotation.x = deg(70 + j.tail);
        const tl = 0.45 * H;
        tail.add(limb(mat, tl, W * 0.16, W * 0.04));
        anchor(tail, "tail", 0, -tl * 0.95, 0);
        pelvis.add(tail);
      }
      break;
    }
  }

  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  const points: Partial<Record<CreaturePart, THREE.Vector3>> = {};
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    else if (o.name && o.name in CREATURE_PARTS) points[o.name as CreaturePart] = o.getWorldPosition(new THREE.Vector3());
  });
  return { root, meshes, points, look: look.getWorldPosition(new THREE.Vector3()) };
}

// ---------------------------------------------------------------- Euros の body を読む

/** Euros の形の種類の名前(別名も受け付ける)→ Boreas の形の種類 */
const FORM_ALIASES: Record<string, CreatureForm> = {
  sphere: "sphere",
  ball: "sphere",
  球: "sphere",
  blob: "blob",
  amorphous: "blob",
  slime: "blob",
  不定形: "blob",
  quadruped: "quadruped",
  四足: "quadruped",
  biped: "biped",
  monster: "biped",
  二足: "biped",
  二足の怪物: "biped",
  object: "object",
  box: "object",
  物: "object",
};

/** 大きさの項目の別名(Euros の書き方が決まるまで、cm で書いたものも受け付ける) */
const SIZE_ALIASES: Record<string, string> = { diameter: "diameter", width: "width", depth: "depth", height: "height", length: "length", girth: "width" };

/**
 * Euros のキャラクターの body({ form, size })を読む。読めなければ null。
 * 大きさは m。"Cm" で終わる項目(heightCm など)は cm として読む
 */
export function parseBody(raw: unknown): CreatureBody | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { form?: unknown; size?: unknown; arms?: unknown; tail?: unknown };
  const form = typeof o.form === "string" ? FORM_ALIASES[o.form.trim().toLowerCase()] ?? FORM_ALIASES[o.form.trim()] : undefined;
  if (!form) return null;
  const size: Record<string, number> = {};
  if (o.size && typeof o.size === "object") {
    for (const [k, v] of Object.entries(o.size as Record<string, unknown>)) {
      if (typeof v !== "number" || !(v > 0)) continue;
      const cm = /Cm$/.test(k);
      const key = SIZE_ALIASES[cm ? k.slice(0, -2) : k];
      if (key) size[key] = cm ? v / 100 : v;
    }
  }
  const def = CREATURE_FORMS[form].size as Record<string, number>;
  return {
    form,
    size: Object.fromEntries(Object.keys(def).map((k) => [k, size[k] ?? def[k]])),
    ...(typeof o.arms === "boolean" ? { arms: o.arms } : {}),
    ...(typeof o.tail === "boolean" ? { tail: o.tail } : {}),
  };
}

/** 形の種類の初期値の体 */
export function defaultBody(form: CreatureForm): CreatureBody {
  return { form, size: { ...(CREATURE_FORMS[form].size as Record<string, number>) } };
}

/** Euros に body がないとき、説明の文章から形の種類を推定する(画面と Ollama で直せる) */
export function guessForm(text: string): CreatureForm {
  if (/スライム|不定形|ゼリー|餅|slime|blob|jelly|amorphous|ooze/i.test(text)) return "blob";
  if (/球|玉|丸い|ドローン|sphere|ball|orb|drone/i.test(text)) return "sphere";
  if (/四足|犬|猫|狼|狐|獣|馬|dog|cat|wolf|fox|beast|horse|quadruped/i.test(text)) return "quadruped";
  if (/怪獣|巨人|ゴーレム|鬼|竜|ドラゴン|二足|monster|giant|golem|ogre|dragon|kaiju/i.test(text)) return "biped";
  if (/ロボット|機械|像|robot|machine|statue/i.test(text)) return "object";
  return "blob";
}
