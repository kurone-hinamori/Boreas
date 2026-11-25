import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Stage, type StageCamera } from "../lib/stage";
import type { ScenePerson } from "../lib/scene";

export interface ViewportHandle {
  /** 下絵を撮る(PNG) */
  capture: (width: number, height: number) => Promise<Uint8Array>;
}

interface Props {
  people: ScenePerson[];
  camera: StageCamera;
  /** 枠の縦横比(幅 / 高さ) */
  aspect: number;
  onCamera: (c: StageCamera) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 場面の 3D 表示。ドラッグでカメラを回し、ホイールで近づける */
export const Viewport = forwardRef<ViewportHandle, Props>(function Viewport({ people, camera, aspect, onCamera }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Stage | null>(null);
  const figureKey = useRef("");
  const latest = useRef({ camera, onCamera });
  latest.current = { camera, onCamera };

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
      figureKey.current = "";
    };
  }, []);

  // 枠に合わせて大きさを決める(親の幅と高さに収まる、いちばん大きな枠)
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
      stage.current?.render();
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

  // 素体が変わったときだけ読み直し、ほかはポーズを付け直す
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    const key = people.map((p) => p.figure).join(",");
    if (key !== figureKey.current) {
      figureKey.current = key;
      void s.setPeople(people).then(() => s.render());
    } else {
      s.updatePeople(people);
      s.render();
    }
  }, [people]);

  useEffect(() => {
    stage.current?.setCamera(camera);
    stage.current?.render();
  }, [camera]);

  const drag = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    let x = e.clientX;
    let y = e.clientY;
    const move = (ev: PointerEvent) => {
      const c = latest.current.camera;
      const dx = ev.clientX - x;
      const dy = ev.clientY - y;
      x = ev.clientX;
      y = ev.clientY;
      if (ev.shiftKey) {
        // Shift を押しながら上下で、注視点の高さを変える
        latest.current.onCamera({ ...c, targetY: clamp(c.targetY + dy * 0.005, -0.5, 3) });
      } else {
        latest.current.onCamera({ ...c, yaw: Math.round((c.yaw - dx * 0.4) * 10) / 10, pitch: clamp(Math.round((c.pitch + dy * 0.3) * 10) / 10, -60, 80) });
      }
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const wheel = (e: React.WheelEvent) => {
    const c = latest.current.camera;
    latest.current.onCamera({ ...c, distance: clamp(Math.round(c.distance * (e.deltaY > 0 ? 1.08 : 1 / 1.08) * 100) / 100, 0.5, 20) });
  };

  return (
    <div ref={box} className="viewport" onPointerDown={drag} onWheel={wheel} title="ドラッグでカメラを回す・Shift+ドラッグで高さ・ホイールで近づける">
      <canvas ref={canvas} />
    </div>
  );
});
