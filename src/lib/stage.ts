import * as THREE from "three";
import { Figure, type FigureId, PERSON_COLORS } from "./figures";
import { type PoseId, POSES } from "./poses";

/** 場面の 3D 表示。下絵(清書に渡す画像)もここで撮る */

export interface StagePerson {
  figure: FigureId;
  /** 身長(cm) */
  heightCm: number;
  /** 立ち位置(m)と体の向き(度。0 でカメラの初期位置の方を向く) */
  x: number;
  z: number;
  rotation: number;
  pose: PoseId;
  /** 首の向き(度)。yaw は左右(+ で人物の左)、pitch は上下(+ で下を向く) */
  headYaw: number;
  headPitch: number;
  /** 色の番号(PERSON_COLORS) */
  color: number;
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
}

export const DEFAULT_CAMERA: StageCamera = { yaw: 0, pitch: 4, distance: 4.2, targetY: 0.85, fov: 35 };

const BG = 0xffffff;

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
  private figures: Figure[] = [];
  private seats: THREE.Mesh[] = [];
  private loading = 0;
  private aspect = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setClearColor(BG);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8888aa, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(-1.5, 3, 2.5);
    this.scene.add(sun);
    // 床の目安(清書では描かない。立ち位置と大きさの手がかり)
    const ground = new THREE.Mesh(new THREE.CircleGeometry(2.4, 64), new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
  }

  /** 表示する大きさ(px)と、枠の縦横比 */
  resize(width: number, height: number) {
    this.renderer.setSize(width, height, false);
    this.aspect = width / height;
  }

  /** 人物を並べ直す。素体の読み込みが終わってから表示を変える */
  async setPeople(people: StagePerson[]) {
    const ticket = ++this.loading;
    const loaded = await Promise.all(people.map((p) => Figure.load(p.figure)));
    if (ticket !== this.loading) return loaded.forEach((f) => f.dispose());
    this.figures.forEach((f) => f.dispose());
    this.seats.forEach((s) => s.removeFromParent());
    this.seats = [];
    this.figures = loaded;
    loaded.forEach((f, i) => {
      this.scene.add(f.root);
      this.pose(f, people[i]);
    });
  }

  /** 素体を読み直さずに、ポーズと立ち位置だけを変える */
  updatePeople(people: StagePerson[]) {
    this.seats.forEach((s) => s.removeFromParent());
    this.seats = [];
    this.figures.forEach((f, i) => people[i] && this.pose(f, people[i]));
  }

  private pose(f: Figure, p: StagePerson) {
    f.setColor(PERSON_COLORS[p.color % PERSON_COLORS.length].hex);
    f.setHeight(p.heightCm / 100);
    f.root.position.set(p.x, 0, p.z);
    f.root.rotation.y = THREE.MathUtils.degToRad(p.rotation);
    f.pose(p.pose);
    f.turn("neck_01", [0, 1, 0], p.headYaw * 0.4);
    f.turn("head", [0, 1, 0], p.headYaw * 0.6);
    f.turn("neck_01", [1, 0, 0], p.headPitch * 0.4);
    f.turn("head", [1, 0, 0], p.headPitch * 0.6);
    if (POSES.find((d) => d.id === p.pose)?.seat) {
      // 座面の高さは、身長の 0.25 倍ほど(膝の高さ)
      const h = (p.heightCm / 100) * 0.25;
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, h, 0.42), new THREE.MeshStandardMaterial({ color: 0x9a7a5a }));
      seat.position.set(0, h / 2, -0.02);
      f.root.add(seat);
      this.seats.push(seat);
    }
  }

  setCamera(c: StageCamera) {
    const yaw = THREE.MathUtils.degToRad(c.yaw);
    const pitch = THREE.MathUtils.degToRad(c.pitch);
    const target = new THREE.Vector3(0, c.targetY, 0);
    this.camera.position.set(
      target.x + c.distance * Math.cos(pitch) * Math.sin(yaw),
      target.y + c.distance * Math.sin(pitch),
      target.z + c.distance * Math.cos(pitch) * Math.cos(yaw),
    );
    this.camera.fov = c.fov;
    this.camera.lookAt(target);
  }

  render() {
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }

  /** 下絵を撮る。width × height(px)の PNG を返す */
  async capture(width: number, height: number): Promise<Uint8Array> {
    const target = new THREE.WebGLRenderTarget(width, height, { samples: 4 });
    // 画面と同じ色にする(指定しないと、暗い色で読み出される)
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const camera = this.camera.clone();
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, camera);
    const pixels = new Uint8Array(width * height * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    this.renderer.setRenderTarget(null);
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
    this.renderer.dispose();
  }
}
