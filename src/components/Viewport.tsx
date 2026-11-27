import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { LimbId } from "../lib/figures";
import { Stage, type StageCamera, type StageState, type Vec3 } from "../lib/stage";

export interface ViewportHandle {
  /** 下絵を撮る(PNG) */
  capture: (width: number, height: number) => Promise<Uint8Array>;
}

interface Props {
  state: StageState;
  selected: number | null;
  camera: StageCamera;
  /** 枠の縦横比(幅 / 高さ) */
  aspect: number;
  onCamera: (c: StageCamera) => void;
  onSelect: (person: number | null) => void;
  onMovePerson: (person: number, x: number, z: number) => void;
  /** 人ではない登場人物を選ぶ・動かす */
  onSelectCreature: (creature: number) => void;
  onMoveCreature: (creature: number, x: number, z: number) => void;
  onLimb: (person: number, limb: LimbId, pos: Vec3) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, step = 0.01) => Math.round(v / step) * step;

/**
 * 場面の 3D 表示。
 * 人物・人ではない登場人物をクリックで選び、ドラッグで床の上を動かす。選んだ人物の黒い点(手足の先)をドラッグで動かす。
 * 何もない所のドラッグでカメラを回す(Shift で高さ、Ctrl で平行に動かす)。ホイールで近づける
 */
export const Viewport = forwardRef<ViewportHandle, Props>(function Viewport(props, ref) {
  const { state, selected, camera, aspect } = props;
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Stage | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useImperativeHandle(ref, () => ({
    capture: (w, h) => {
      if (!stage.current) throw new Error("3D の表示がまだ準備できていません");
      return stage.current.capture(w, h);
    },
  }));

  useEffect(() => {
    const s = new Stage(canvas.current!);
    stage.current = s;
    return () => {
      s.dispose();
      stage.current = null;
    };
  }, []);

  // 枠に合わせて大きさを決める(親の幅と画面の高さに収まる、いちばん大きな枠)
  useEffect(() => {
    const el = box.current!;
    const fit = () => {
      const parent = el.parentElement!;
      const maxW = parent.clientWidth;
      const maxH = Math.max(320, window.innerHeight - 200);
      const w = Math.min(maxW, maxH * aspect);
      const h = w / aspect;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      stage.current?.resize(Math.round(w), Math.round(h));
      if (stage.current) {
        stage.current.setCamera(latest.current.camera);
        stage.current.render();
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el.parentElement!);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [aspect]);

  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    s.setCamera(camera);
    void s.setState(state, selected).then(() => s.render());
  }, [state, selected, camera]);

  const ndc = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1] as const;
  };

  const down = (e: React.PointerEvent) => {
    const s = stage.current;
    if (!s) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const [nx, ny] = ndc(e);
    const hit = e.shiftKey || e.ctrlKey ? null : s.pick(nx, ny);
    let x = e.clientX;
    let y = e.clientY;
    let moved = false;
    // 人物を動かすときは、つかんだ位置と立ち位置のずれを保つ
    let offset: [number, number] = [0, 0];
    if (hit?.kind === "person" || hit?.kind === "creature") {
      const p = hit.kind === "person" ? latest.current.state.people[hit.person] : latest.current.state.creatures?.[hit.creature];
      if (hit.kind === "person") latest.current.onSelect(hit.person);
      else latest.current.onSelectCreature(hit.creature);
      const f = s.floorPoint(nx, ny);
      if (f && p) offset = [p.x - f.x, p.z - f.z];
    }

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x;
      const dy = ev.clientY - y;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      x = ev.clientX;
      y = ev.clientY;
      const [mx, my] = ndc(ev);
      const c = latest.current.camera;
      if (hit?.kind === "handle") {
        const pos = s.dragLimb(hit.person, hit.limb, mx, my);
        if (pos) latest.current.onLimb(hit.person, hit.limb, pos);
      } else if (hit?.kind === "person") {
        const f = s.floorPoint(mx, my);
        if (f) latest.current.onMovePerson(hit.person, round(f.x + offset[0]), round(f.z + offset[1]));
      } else if (hit?.kind === "creature") {
        const f = s.floorPoint(mx, my);
        if (f) latest.current.onMoveCreature(hit.creature, round(f.x + offset[0]), round(f.z + offset[1]));
      } else if (ev.shiftKey) {
        latest.current.onCamera({ ...c, targetY: round(clamp(c.targetY + dy * 0.005, -0.5, 3)) });
      } else if (ev.ctrlKey) {
        // カメラの向きに合わせて、注視点を床と平行に動かす
        const yaw = (c.yaw * Math.PI) / 180;
        const k = c.distance * 0.0015;
        const tx = (c.targetX ?? 0) - (Math.cos(yaw) * dx - Math.sin(yaw) * dy) * k;
        const tz = (c.targetZ ?? 0) - (-Math.sin(yaw) * dx - Math.cos(yaw) * dy) * k;
        latest.current.onCamera({ ...c, targetX: round(tx), targetZ: round(tz) });
      } else {
        latest.current.onCamera({ ...c, yaw: round(c.yaw - dx * 0.4, 0.1), pitch: clamp(round(c.pitch + dy * 0.3, 0.1), -60, 80) });
      }
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      // 何もない所をクリックしたら、選ぶのをやめる
      if (!hit && !moved) latest.current.onSelect(null);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const wheel = (e: React.WheelEvent) => {
    const c = latest.current.camera;
    latest.current.onCamera({ ...c, distance: clamp(round(c.distance * (e.deltaY > 0 ? 1.08 : 1 / 1.08)), 0.5, 20) });
  };

  return (
    <div ref={box} className="viewport" onPointerDown={down} onWheel={wheel}>
      <canvas ref={canvas} />
    </div>
  );
});
