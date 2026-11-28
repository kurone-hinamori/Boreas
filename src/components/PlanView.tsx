import { useRef } from "react";
import { floorBounds, footprint, furnitureColor, furnitureLabel, nearestWall, type P2, type Place, ROOM_COLORS, toPlace, wallsOf } from "../lib/place";

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/** 間取り図で選んでいる物 */
export type PlanPick = { kind: "furniture"; id: string } | { kind: "opening"; id: string } | null;

interface Props {
  place: Place;
  selected: PlanPick;
  /** 警告のある家具・窓・ドアの id */
  warned: Set<string>;
  onSelect: (p: PlanPick) => void;
  onMoveFurniture: (id: string, x: number, z: number) => void;
  /** 窓・ドアは、いちばん近い壁の上に寄せる(呼び出し側で) */
  onMoveOpening: (id: string, x: number, z: number) => void;
  /** 人物などの立ち位置(m)。場面の間取り図で、どこにいるかを見せる */
  marks?: { x: number; z: number; color: number; label: string }[];
  /** カメラ(m)と向き(度) */
  camera?: { x: number; z: number; yaw: number; fov: number };
}

/** 上から見た間取り図(cm)。+X が右、+Z が下。家具・窓・ドアはドラッグで動かす */
export function PlanView({ place, selected, warned, onSelect, onMoveFurniture, onMoveOpening, marks, camera }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [x0, z0, x1, z1] = floorBounds(place.floor);
  const pad = 60;
  const walls = wallsOf(place.floor);

  const toCm = (e: { clientX: number; clientY: number }): P2 => {
    const el = svg.current!;
    const m = el.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  };

  const drag = (e: React.PointerEvent, pick: NonNullable<PlanPick>, origin: P2) => {
    e.stopPropagation();
    onSelect(pick);
    const el = e.currentTarget as Element;
    el.setPointerCapture(e.pointerId);
    const start = toCm(e);
    const move = (ev: PointerEvent) => {
      const p = toCm(ev);
      const x = Math.round(origin[0] + p[0] - start[0]);
      const z = Math.round(origin[1] + p[1] - start[1]);
      if (pick.kind === "furniture") onMoveFurniture(pick.id, x, z);
      else onMoveOpening(pick.id, x, z);
    };
    const up = () => {
      el.removeEventListener("pointermove", move as EventListener);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move as EventListener);
    el.addEventListener("pointerup", up);
  };

  // 目盛り(50cm ごと)
  const grid: React.ReactNode[] = [];
  for (let x = Math.ceil((x0 - pad) / 50) * 50; x <= x1 + pad; x += 50) grid.push(<line key={`gx${x}`} x1={x} y1={z0 - pad} x2={x} y2={z1 + pad} className={x % 100 ? "plan-grid" : "plan-grid major"} />);
  for (let z = Math.ceil((z0 - pad) / 50) * 50; z <= z1 + pad; z += 50) grid.push(<line key={`gz${z}`} x1={x0 - pad} y1={z} x2={x1 + pad} y2={z} className={z % 100 ? "plan-grid" : "plan-grid major"} />);

  return (
    <svg ref={svg} className="plan" viewBox={`${x0 - pad} ${z0 - pad} ${x1 - x0 + pad * 2} ${z1 - z0 + pad * 2}`} onPointerDown={() => onSelect(null)}>
      {grid}
      {place.floor.map((r, i) => (
        <rect key={i} x={r.x} y={r.z} width={r.width} height={r.depth} fill={hex(ROOM_COLORS.floor.hex)} fillOpacity={0.35} />
      ))}
      {walls.map((w, i) => (
        <line key={i} x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]} className="plan-wall" />
      ))}
      {place.openings.map((o) => {
        const near = nearestWall(walls, [o.x, o.z]);
        if (!near) return null;
        const w = near.wall;
        const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
        const u: P2 = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
        const h = o.widthCm / 2;
        const a: P2 = [o.x - u[0] * h, o.z - u[1] * h];
        const b: P2 = [o.x + u[0] * h, o.z + u[1] * h];
        const sel = selected?.kind === "opening" && selected.id === o.id;
        // ドアは開く向き(部屋の内側)に弧を描く
        const n = w.normal;
        const swing: P2 = [a[0] + n[0] * o.widthCm, a[1] + n[1] * o.widthCm];
        return (
          <g key={o.id} className={`plan-opening${sel ? " selected" : ""}${warned.has(o.id) ? " warned" : ""}`} onPointerDown={(e) => drag(e, { kind: "opening", id: o.id }, [o.x, o.z])}>
            {o.kind === "door" && <path d={`M ${b[0]} ${b[1]} A ${o.widthCm} ${o.widthCm} 0 0 ${u[0] * n[1] - u[1] * n[0] > 0 ? 1 : 0} ${swing[0]} ${swing[1]} L ${a[0]} ${a[1]}`} className="plan-swing" />}
            <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={hex(o.kind === "door" ? ROOM_COLORS.door.hex : ROOM_COLORS.window.hex)} strokeWidth={o.kind === "door" ? 9 : 7} />
            <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="transparent" strokeWidth={24} />
          </g>
        );
      })}
      {place.furniture.map((f) => {
        const pts = footprint(f);
        const sel = selected?.kind === "furniture" && selected.id === f.id;
        const front = [toPlace(f, -f.widthCm * 0.3, f.depthCm / 2 - 4), toPlace(f, f.widthCm * 0.3, f.depthCm / 2 - 4)];
        const c = furnitureColor(f);
        return (
          <g key={f.id} className={`plan-furniture${sel ? " selected" : ""}${warned.has(f.id) ? " warned" : ""}`} onPointerDown={(e) => drag(e, { kind: "furniture", id: f.id }, [f.x, f.z])}>
            <polygon points={pts.map((p) => p.join(",")).join(" ")} fill={hex(c.hex)} fillOpacity={0.55} />
            <line x1={front[0][0]} y1={front[0][1]} x2={front[1][0]} y2={front[1][1]} className="plan-front" />
            <text x={f.x} y={f.z} className="plan-label">
              {furnitureLabel(f)}
            </text>
          </g>
        );
      })}
      {marks?.map((m, i) => (
        <g key={`m${i}`} className="plan-mark">
          <circle cx={m.x * 100} cy={m.z * 100} r={14} fill={hex(m.color)} />
          <text x={m.x * 100} y={m.z * 100 - 20} className="plan-label">
            {m.label}
          </text>
        </g>
      ))}
      {camera && <CameraMark {...camera} />}
    </svg>
  );
}

/** カメラの位置と、写る範囲(左右の画角) */
function CameraMark({ x, z, yaw, fov }: { x: number; z: number; yaw: number; fov: number }) {
  const cx = x * 100;
  const cz = z * 100;
  const r = (d: number) => (d * Math.PI) / 180;
  // カメラは yaw の向きから注視点を見る(yaw 0 で +Z から -Z を見る)
  const look = r(yaw) + Math.PI;
  const half = r(fov) / 2;
  const len = 120;
  const p = (a: number): P2 => [cx + Math.sin(a) * len, cz + Math.cos(a) * len];
  const [l, rr] = [p(look - half), p(look + half)];
  return (
    <g className="plan-camera">
      <path d={`M ${cx} ${cz} L ${l[0]} ${l[1]} L ${rr[0]} ${rr[1]} Z`} />
      <circle cx={cx} cy={cz} r={10} />
    </g>
  );
}
