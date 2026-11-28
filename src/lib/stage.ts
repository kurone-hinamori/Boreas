import * as THREE from "three";
import { BODY_PARTS, type BodyPart, Figure, type FigureId, type HandShape, LIMBS, type LimbId, PERSON_COLORS } from "./figures";
import { type PoseId, POSES } from "./poses";
import { dirFromAngles, PROP_COLORS, PROP_KINDS, type PropShape, propMesh } from "./props";
import { type BuiltCreature, buildCreature, type CreaturePart, type Exaggeration, NO_EXAGGERATION, type StageCreature } from "./creatures";
import { buildRoom, furnitureMesh, type Place, seatAt, seatHeight, type Visible, visibleFurniture } from "./place";

/** 場面の 3D 表示。下絵(清書に渡す画像)もここで撮る */

/** 人物から見た位置(m)。+Z が前、+X が人物の左、+Y が上 */
export type Vec3 = [number, number, number];

export type Gaze = { kind: "manual" } | { kind: "camera" } | { kind: "person"; index: number } | { kind: "creature"; index: number };

export interface StagePerson {
  figure: FigureId;
  /** 身長(cm) */
  heightCm: number;
  /** 立ち位置(m)と体の向き(度。0 でカメラの初期位置の方を向く) */
  x: number;
  z: number;
  rotation: number;
  pose: PoseId;
  /** 首の向き(度)。yaw は左右(+ で人物の左)、pitch は上下(+ で下を向く)。視線が manual のときに使う */
  headYaw: number;
  headPitch: number;
  /** 色の番号(PERSON_COLORS) */
  color: number;
  /** 手の形 */
  hands?: { l: HandShape; r: HandShape };
  /** 関節をつかんで動かした手足の先の位置(人物から見た位置)。ないときはポーズのまま */
  ik?: Partial<Record<LimbId, Vec3>>;
  /** 視線 */
  gaze?: Gaze;
}

export interface StageProp extends PropShape {
  /** 色の番号(PROP_COLORS) */
  color: number;
  /** 持つ人物(people の番号)と手。null なら床に置く */
  holder: { person: number; side: "l" | "r" } | null;
  /** 床に置くときの位置(m) */
  x: number;
  z: number;
  /** 向き(度)。持つときは人物から見た向き、置くときは場面の向き */
  yaw: number;
  pitch: number;
  /** 誇張(場面だけで大きさを変える倍率。長さ・太さ)。小物の寸法そのものは変えない */
  scale?: Exaggeration;
}

export type ContactFrom = { kind: "hand"; person: number; side: "l" | "r" } | { kind: "prop"; prop: number };

/** 触れられる側:人物の部位か、人ではない登場人物の部位 */
export type ContactTo = { person: number; part: BodyPart } | { creature: number; part: CreaturePart };

export const isCreatureTarget = (t: ContactTo): t is { creature: number; part: CreaturePart } => "creature" in t;

export interface StageContact {
  from: ContactFrom;
  to: ContactTo;
}

export interface StageState {
  people: StagePerson[];
  /** 人ではない登場人物 */
  creatures?: StageCreature[];
  props: StageProp[];
  contacts: StageContact[];
  /** 場所(部屋・家具)。ないときは床の目安の円だけ */
  place?: Place | null;
}

export interface StageCamera {
  /** 人物のまわりを回る角度(度)。0 で正面 */
  yaw: number;
  /** 見下ろす角度(度)。+ で上から、- で下から */
  pitch: number;
  /** 注視点からの距離(m) */
  distance: number;
  /** 注視点の高さ(m) */
  targetY: number;
  /** 縦の画角(度) */
  fov: number;
  /** 注視点の床の位置(m) */
  targetX?: number;
  targetZ?: number;
}

export const DEFAULT_CAMERA: StageCamera = { yaw: 0, pitch: 4, distance: 4.2, targetY: 0.85, fov: 35, targetX: 0, targetZ: 0 };

/** クリックした物 */
export type Pick = { kind: "handle"; person: number; limb: LimbId } | { kind: "person"; person: number } | { kind: "creature"; creature: number } | null;

const BG = 0xffffff;
/** 触れる点の印の色(編集の画面にだけ出す) */
export const MARK_COLOR = 0xd02020;

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
  private figures: Figure[] = [];
  private figureKey = "";
  /** 状態が変わるたびに作り直す物(椅子・小物・印・つかむ点) */
  private extras = new THREE.Group();
  /** 人ではない登場人物(状態が変わるたびに作り直す) */
  private creatures = new THREE.Group();
  private built: BuiltCreature[] = [];
  private handles = new THREE.Group();
  /** 場所(部屋と家具)。場所が変わったときだけ作り直す */
  private room = new THREE.Group();
  private roomMesh: THREE.Group | null = null;
  private furniture: THREE.Group[] = [];
  private placeRef: Place | null | undefined = undefined;
  private ground: THREE.Mesh;
  private loading = 0;
  private aspect = 1;
  private state: StageState = { people: [], props: [], contacts: [] };
  private selected: number | null = null;
  private raycaster = new THREE.Raycaster();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setClearColor(BG);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8888aa, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(-1.5, 3, 2.5);
    this.scene.add(sun);
    // 床の目安(清書では描かない。立ち位置と大きさの手がかり)
    const ground = new THREE.Mesh(new THREE.CircleGeometry(3, 64), new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
    ground.rotation.x = -Math.PI / 2;
    this.ground = ground;
    this.scene.add(ground, this.room, this.extras, this.creatures, this.handles);
  }

  /** 表示する大きさ(px)と、枠の縦横比 */
  resize(width: number, height: number) {
    this.renderer.setSize(width, height, false);
    this.aspect = width / height;
  }

  /** 場面の状態を表示に反映する。素体が変わったときだけ読み直す */
  async setState(state: StageState, selected: number | null) {
    this.state = state;
    this.selected = selected;
    if (state.place !== this.placeRef) this.buildPlace(state.place ?? null);
    const key = state.people.map((p) => p.figure).join(",");
    if (key !== this.figureKey) {
      const ticket = ++this.loading;
      const loaded = await Promise.all(state.people.map((p) => Figure.load(p.figure)));
      if (ticket !== this.loading) return loaded.forEach((f) => f.dispose());
      this.figures.forEach((f) => f.dispose());
      this.figures = loaded;
      this.figureKey = key;
      loaded.forEach((f) => this.scene.add(f.root));
    }
    this.apply();
  }

  /** 部屋と家具を作り直す。場所があるときは、床の目安の円を出さない */
  private buildPlace(place: Place | null) {
    this.placeRef = place;
    this.clear(this.room);
    this.furniture = [];
    this.roomMesh = null;
    this.ground.visible = !place;
    if (!place) return;
    this.roomMesh = buildRoom(place);
    this.furniture = place.furniture.map(furnitureMesh);
    this.room.add(this.roomMesh, ...this.furniture);
  }

  /** いまのカメラから見える家具(設計書 5.5:場所があるときは、そのカメラから見える家具の一覧を出す) */
  visibleFurniture(aspect = this.aspect): Visible[] {
    if (!this.placeRef) return [];
    const camera = this.camera.clone();
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    return visibleFurniture(camera, this.roomMesh, this.furniture);
  }

  /** ポーズ → 人ではない登場人物 → つかんだ手足 → 触れる点 → 視線 → 小物 の順に決める */
  private apply() {
    const { people, props, contacts } = this.state;
    if (this.figures.length !== people.length) return;
    this.clear(this.extras);
    this.clear(this.handles);
    this.clear(this.creatures);
    this.built = (this.state.creatures ?? []).map((c) => {
      const b = buildCreature(c, PERSON_COLORS[c.color % PERSON_COLORS.length].hex);
      this.creatures.add(b.root);
      return b;
    });

    people.forEach((p, i) => {
      const f = this.figures[i];
      f.setColor(PERSON_COLORS[p.color % PERSON_COLORS.length].hex);
      f.setHeight(p.heightCm / 100);
      // 座るポーズで、場所の椅子・ソファ・ベッドの上にいれば、その座面の高さに合わせる
      const seatPose = POSES.find((d) => d.id === p.pose)?.seat;
      const seat = seatPose ? seatAt(this.state.place, p.x, p.z) : null;
      const kneeHeight = (p.heightCm / 100) * 0.25;
      f.root.position.set(p.x, seat ? ((seat.elevationCm ?? 0) + seatHeight(seat)) / 100 - kneeHeight : 0, p.z);
      f.root.rotation.y = THREE.MathUtils.degToRad(p.rotation);
      f.pose(p.pose);
      // 小物を持つ手は、形を決めていなければ握る
      const holds = (side: "l" | "r") => props.some((pr) => pr.holder?.person === i && pr.holder.side === side);
      for (const side of ["l", "r"] as const) {
        const shape = p.hands?.[side] ?? "auto";
        f.handShape(side, shape === "auto" && holds(side) ? "fist" : shape);
      }
      if (seatPose && !seat) {
        // 座面の高さは、身長の 0.25 倍ほど(膝の高さ)
        const h = kneeHeight;
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, h, 0.42), new THREE.MeshStandardMaterial({ color: 0x9a7a5a }));
        box.position.set(0, h / 2, -0.02);
        box.applyMatrix4(f.root.matrix);
        this.extras.add(box);
      }
    });

    // 関節をつかんで動かした手足
    people.forEach((p, i) => {
      for (const [limb, pos] of Object.entries(p.ik ?? {}) as [LimbId, Vec3][]) this.figures[i].reach(limb, this.figures[i].toWorld(new THREE.Vector3(...pos)));
    });

    // 触れる点:手を相手の部位に寄せる。小物は先を相手に向け、手の位置を合わせる
    for (const c of contacts) {
      const target = this.contactPoint(c);
      if (!target) continue;
      if (c.from.kind === "hand") {
        this.figures[c.from.person]?.reach(`hand_${c.from.side}`, target);
      } else {
        const prop = props[c.from.prop];
        const holder = prop?.holder && this.figures[prop.holder.person];
        if (prop?.holder && holder) {
          const shoulder = holder.bonePosition(`upperarm_${prop.holder.side}`)!;
          const dir = target.clone().sub(shoulder).normalize();
          const tip = this.propLength(prop) * (1 - prop.grip);
          holder.reach(`hand_${prop.holder.side}`, target.clone().sub(dir.multiplyScalar(tip)));
        }
      }
      const mark = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), new THREE.MeshBasicMaterial({ color: MARK_COLOR }));
      mark.position.copy(target);
      // 印は編集の画面にだけ出す(下絵に写すと、清書で黒い点が描かれることがあった)
      this.handles.add(mark);
    }

    // 視線
    people.forEach((p, i) => {
      const f = this.figures[i];
      const gaze = p.gaze ?? { kind: "manual" };
      if (gaze.kind === "manual") return f.turnHead(p.headYaw, p.headPitch);
      const target =
        gaze.kind === "camera" ? this.camera.position.clone() : gaze.kind === "creature" ? this.built[gaze.index]?.look.clone() : this.figures[gaze.index]?.bonePosition("head");
      if (!target || (gaze.kind === "person" && gaze.index === i)) return f.turnHead(p.headYaw, p.headPitch);
      const a = f.gazeAngles(target);
      f.turnHead(a.yaw, a.pitch);
    });

    // 小物
    props.forEach((prop, k) => {
      const mesh = propMesh(this.scaled(prop), PROP_COLORS[prop.color % PROP_COLORS.length].hex);
      const holder = prop.holder && this.figures[prop.holder.person];
      if (prop.holder && holder) {
        // 握る位置は、手首より少し先(中指の付け根)
        const hand = holder.bonePosition(`middle_01_${prop.holder.side}`)!;
        // 触れる点があれば先を相手に向ける。なければ指定の向き
        const contact = contacts.find((c) => c.from.kind === "prop" && c.from.prop === k);
        const target = contact && this.contactPoint(contact);
        const dir = target ? target.clone().sub(hand).normalize() : holder.dirToWorld(dirFromAngles(prop.yaw, prop.pitch));
        mesh.position.copy(hand);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      } else if (PROP_KINDS[prop.kind].long) {
        // 床に寝かせる(太さの半分だけ浮かせる)
        mesh.position.set(prop.x, this.scaled(prop).widthCm / 200, prop.z);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dirFromAngles(prop.yaw, prop.pitch)));
      } else {
        mesh.position.set(prop.x, 0, prop.z);
        mesh.rotation.y = THREE.MathUtils.degToRad(prop.yaw);
      }
      this.extras.add(mesh);
    });

    // 選んだ人物の、つかめる手足の先
    if (this.selected !== null && this.figures[this.selected]) {
      const f = this.figures[this.selected];
      for (const limb of Object.keys(LIMBS) as LimbId[]) {
        const h = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: false, transparent: true, opacity: 0.85 }));
        h.renderOrder = 999;
        h.position.copy(f.bonePosition(LIMBS[limb].bones[2])!);
        h.userData = { person: this.selected, limb };
        this.handles.add(h);
      }
    }
  }

  /** 誇張の倍率を掛けた寸法 */
  private scaled(p: StageProp): StageProp {
    const s = p.scale ?? NO_EXAGGERATION;
    return { ...p, lengthCm: p.lengthCm * s.all * s.length, widthCm: p.widthCm * s.all * s.width, heightCm: p.heightCm * s.all };
  }

  private propLength(p: StageProp) {
    return this.scaled(p).lengthCm / 100;
  }

  /** 触れる点の位置。体の中の骨から、触れる側に少し出す(体の表面のあたり) */
  private contactPoint(c: StageContact): THREE.Vector3 | null {
    // 人ではない登場人物は、部位の位置が表面(へこみがあれば、へこみの底)
    if (isCreatureTarget(c.to)) {
      const b = this.built[c.to.creature];
      return b ? (b.points[c.to.part] ?? b.look).clone() : null;
    }
    const f = this.figures[c.to.person];
    if (!f) return null;
    const p = f.bonePosition(BODY_PARTS[c.to.part].bone);
    if (!p) return null;
    const fromFigure = c.from.kind === "hand" ? this.figures[c.from.person] : this.state.props[c.from.prop]?.holder ? this.figures[this.state.props[c.from.prop].holder!.person] : null;
    const toward = fromFigure ? fromFigure.root.position.clone().setY(p.y).sub(p) : new THREE.Vector3();
    const depth = c.to.part === "chest" || c.to.part === "waist" ? 0.1 : c.to.part === "head" ? 0.09 : 0.04;
    if (toward.lengthSq() > 1e-6) p.add(toward.normalize().multiplyScalar(depth));
    return p;
  }

  private clear(g: THREE.Group) {
    for (const o of [...g.children]) {
      o.removeFromParent();
      o.traverse((x) => {
        const m = x as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
    }
  }

  setCamera(c: StageCamera) {
    const yaw = THREE.MathUtils.degToRad(c.yaw);
    const pitch = THREE.MathUtils.degToRad(c.pitch);
    const target = new THREE.Vector3(c.targetX ?? 0, c.targetY, c.targetZ ?? 0);
    this.camera.position.set(
      target.x + c.distance * Math.cos(pitch) * Math.sin(yaw),
      target.y + c.distance * Math.sin(pitch),
      target.z + c.distance * Math.cos(pitch) * Math.cos(yaw),
    );
    this.camera.fov = c.fov;
    this.camera.lookAt(target);
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    // カメラを見る視線は、カメラが動くと変わる
    if (this.state.people.some((p) => p.gaze?.kind === "camera")) this.apply();
  }

  render() {
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }

  /** 画面の位置(-1〜1)にある、つかむ点か人物 */
  pick(nx: number, ny: number): Pick {
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const handle = this.raycaster.intersectObjects(this.handles.children.filter((o) => o.userData.limb), false)[0];
    if (handle) return { kind: "handle", person: handle.object.userData.person, limb: handle.object.userData.limb };
    let best: { person: number; distance: number } | null = null;
    this.figures.forEach((f, i) => {
      const hit = this.raycaster.intersectObjects(f.meshes, false)[0];
      if (hit && (!best || hit.distance < best.distance)) best = { person: i, distance: hit.distance };
    });
    let creature: { index: number; distance: number } | null = null;
    this.built.forEach((b, i) => {
      const hit = this.raycaster.intersectObjects(b.meshes, false)[0];
      if (hit && (!creature || hit.distance < creature.distance)) creature = { index: i, distance: hit.distance };
    });
    const p = best as { person: number; distance: number } | null;
    const c = creature as { index: number; distance: number } | null;
    if (c && (!p || c.distance < p.distance)) return { kind: "creature", creature: c.index };
    return p ? { kind: "person", person: p.person } : null;
  }

  /** 画面の位置と床(y = 0)の交点 */
  floorPoint(nx: number, ny: number): THREE.Vector3 | null {
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  }

  /** つかんだ手足の先を、画面の位置へ動かしたときの位置(カメラに向いた面の上で動かす)。人物から見た位置で返す */
  dragLimb(person: number, limb: LimbId, nx: number, ny: number): Vec3 | null {
    const f = this.figures[person];
    if (!f) return null;
    const current = f.bonePosition(LIMBS[limb].bones[2])!;
    const normal = this.camera.getWorldDirection(new THREE.Vector3());
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hit = this.raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, current), new THREE.Vector3());
    if (!hit) return null;
    const local = f.toLocal(hit);
    const r = (v: number) => Math.round(v * 1000) / 1000;
    return [r(local.x), r(local.y), r(local.z)];
  }

  /** 下絵を撮る。width × height(px)の PNG を返す。つかむ点は写さない */
  async capture(width: number, height: number): Promise<Uint8Array> {
    const target = new THREE.WebGLRenderTarget(width, height, { samples: 4 });
    // 画面と同じ色にする(指定しないと、暗い色で読み出される)
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const camera = this.camera.clone();
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    this.handles.visible = false;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, camera);
    const pixels = new Uint8Array(width * height * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    this.renderer.setRenderTarget(null);
    this.handles.visible = true;
    target.dispose();
    // WebGL の画素は下から上の順なので、上下を反転して画像にする
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    const image = ctx.createImageData(width, height);
    const row = width * 4;
    for (let y = 0; y < height; y++) image.data.set(pixels.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    ctx.putImageData(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("下絵を撮れませんでした"))), "image/png"));
    return new Uint8Array(await blob.arrayBuffer());
  }

  dispose() {
    this.loading++;
    this.figures.forEach((f) => f.dispose());
    this.clear(this.extras);
    this.clear(this.handles);
    this.clear(this.creatures);
    this.clear(this.room);
    this.renderer.dispose();
  }
}
