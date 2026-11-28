import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { Settings } from "../types";
import {
  checkPlace,
  type Design,
  floorBounds,
  FURNITURE_COLORS,
  FURNITURE_KINDS,
  type Furniture,
  type FurnitureKind,
  furnitureLabel,
  isSeat,
  newFurniture,
  newPlaceId,
  normalizePlace,
  OPENING_KINDS,
  type OpeningKind,
  type Place,
  seatHeight,
  snapOpening,
  STYLE_PRESETS,
  wallsOf,
} from "../lib/place";
import { DESIGN_SIZE, furnitureDesignPrompt, makeDesign, roomDesignPrompt } from "../lib/design";
import { translateFields } from "../lib/ollama";
import { useLeaveGuard } from "../lib/leaveGuard";
import { DEFAULT_CAMERA, type StageCamera } from "../lib/stage";
import { deletePlace, loadPlace, openPlaceFolder, placeFileUrl, savePlace } from "../lib/storage";
import { PlanView, type PlanPick } from "./PlanView";
import { Viewport } from "./Viewport";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v.trim() !== "" ? Number(v) : fallback);

/** 場所のフォルダーの画像 */
export function PlaceImage({ placeId, file }: { placeId: string; file: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let made: string | undefined;
    let alive = true;
    placeFileUrl(placeId, file)
      .then((u) => {
        made = u;
        if (alive) setUrl(u);
        else URL.revokeObjectURL(u);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [placeId, file]);
  return url ? <img src={url} alt="" /> : <div className="noimage">読み込み中…</div>;
}

function CmInput(props: { label: string; value: number; min?: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input type="number" min={props.min} disabled={props.disabled} value={props.value} onChange={(e) => props.onChange(num(e.target.value, props.value))} />
    </label>
  );
}

/** 部屋を見下ろす初期のカメラ */
function overview(place: Place): StageCamera {
  const [x0, z0, x1, z1] = floorBounds(place.floor);
  const span = Math.max(x1 - x0, z1 - z0) / 100;
  return { ...DEFAULT_CAMERA, yaw: 20, pitch: 38, distance: Math.max(4, span * 1.7), targetY: 0.6, targetX: (x0 + x1) / 200, targetZ: (z0 + z1) / 200, fov: 40 };
}

type Tab = "room" | "openings" | "furniture" | "check";

/** 場所(部屋・家具)の編集:間取り図と 3D、寸法の点検、部屋・家具のデザイン */
export function PlaceEditor({ id, settings, onBack }: { id: string; settings: Settings; onBack: () => void }) {
  const [place, setPlace] = useState<Place | null>(null);
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [tab, setTab] = useState<Tab>("furniture");
  const [selected, setSelected] = useState<PlanPick>(null);
  const [camera, setCamera] = useState<StageCamera | null>(null);
  // 作っているデザイン(部屋は "room"、家具は家具の id)と、その状態
  const [designing, setDesigning] = useState<{ target: string; text: string } | null>(null);
  const [designError, setDesignError] = useState<{ target: string; text: string } | null>(null);
  const [translating, setTranslating] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const pending = useRef<Place | null>(null);
  useLeaveGuard(designing ? "デザインを作っている途中です。画面を離れると中断します。" : null);
  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    loadPlace(id)
      .then((raw) => {
        const p = normalizePlace(raw);
        setPlace(p);
        setCamera(overview(p));
      })
      .catch((e) => setError(message(e)));
  }, [id]);

  const flush = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    setSaveState("saving");
    try {
      await savePlace(p);
      setSaveState(pending.current ? "saving" : "saved");
    } catch {
      setSaveState("error");
    }
  }, []);

  useEffect(() => () => void flush(), [flush]);

  const change = useCallback(
    (fn: (p: Place) => Place, immediate = false) => {
      setPlace((prev) => {
        if (!prev) return prev;
        const next = { ...fn(prev), updatedAt: new Date().toISOString() };
        pending.current = next;
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => void flush(), immediate ? 0 : 600);
        return next;
      });
      setSaveState("saving");
    },
    [flush],
  );

  const warnings = useMemo(() => (place ? checkPlace(place) : []), [place]);
  const warned = useMemo(() => new Set(warnings.map((w) => w.target)), [warnings]);
  const stage = useMemo(() => ({ people: [], creatures: [], props: [], contacts: [], place }), [place]);

  if (error) {
    return (
      <div className="page">
        <p className="error">場所を読み込めませんでした:{error}</p>
        <button onClick={onBack}>一覧に戻る</button>
      </div>
    );
  }
  if (!place || !camera) return <div className="page muted">読み込み中…</div>;

  const setFurniture = (fid: string, patch: Partial<Furniture>) => change((p) => ({ ...p, furniture: p.furniture.map((f) => (f.id === fid ? { ...f, ...patch } : f)) }));
  const selF = selected?.kind === "furniture" ? place.furniture.find((f) => f.id === selected.id) : undefined;
  const walls = wallsOf(place.floor);
  const [bx0, bz0, bx1, bz1] = floorBounds(place.floor);

  const addFurniture = (kind: FurnitureKind) => {
    const f = newFurniture(kind, place.furniture.map((x) => x.color), { x: Math.round((bx0 + bx1) / 2), z: Math.round((bz0 + bz1) / 2) });
    change((p) => ({ ...p, furniture: [...p.furniture, f] }));
    setSelected({ kind: "furniture", id: f.id });
    setTab("furniture");
  };

  const addOpening = (kind: OpeningKind) => {
    // いちばん長い壁の真ん中に置く
    const w = [...walls].sort((a, b) => Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1]) - Math.hypot(a.b[0] - a.a[0], a.b[1] - a.a[1]))[0];
    if (!w) return;
    const size = OPENING_KINDS[kind].size;
    const o = { id: newPlaceId(), kind, x: (w.a[0] + w.b[0]) / 2, z: (w.a[1] + w.b[1]) / 2, ...size };
    change((p) => ({ ...p, openings: [...p.openings, o] }));
    setSelected({ kind: "opening", id: o.id });
    setTab("openings");
  };

  const moveOpening = (oid: string, x: number, z: number) =>
    change((p) => ({
      ...p,
      openings: p.openings.map((o) => {
        if (o.id !== oid) return o;
        const [sx, sz] = snapOpening(wallsOf(p.floor), { x, z, widthCm: o.widthCm });
        return { ...o, x: sx, z: sz };
      }),
    }));

  /** 日本語の説明を英語にする(Ollama)。部屋と、すべての家具 */
  const translate = async () => {
    setTranslating(true);
    setDesignError(null);
    try {
      const fields = Object.fromEntries([["room", place.description.ja], ...place.furniture.map((f) => [`f_${f.id}`, f.name.ja])]) as Record<string, string>;
      const en = await translateFields(settings, fields);
      change((p) => ({
        ...p,
        description: { ...p.description, en: p.description.ja.trim() ? (en.room ?? p.description.en) : "" },
        furniture: p.furniture.map((f) => ({ ...f, name: { ...f.name, en: f.name.ja.trim() ? (en[`f_${f.id}`] ?? f.name.en) : "" } })),
      }));
    } catch (e) {
      setDesignError({ target: "translate", text: `英語にできませんでした:${message(e)}` });
    } finally {
      setTranslating(false);
    }
  };

  /** デザインを作る。target は "room" か家具の id。日本語だけなら、先に英語にする */
  const design = async (target: string) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setDesignError(null);
    const say = (text: string) => !ctrl.signal.aborted && setDesigning({ target, text });
    try {
      say("説明を確かめています");
      await flush();
      let p = place;
      const f = target === "room" ? null : p.furniture.find((x) => x.id === target);
      const text = target === "room" ? p.description : f?.name;
      if (text && text.ja.trim() && !text.en.trim()) {
        say("説明を英語にしています(Ollama)");
        const en = (await translateFields(settings, { t: text.ja })).t;
        const t = { ...text, en };
        p = target === "room" ? { ...p, description: t } : { ...p, furniture: p.furniture.map((x) => (x.id === target ? { ...x, name: t } : x)) };
        change((cur) => (target === "room" ? { ...cur, description: t } : { ...cur, furniture: cur.furniture.map((x) => (x.id === target ? { ...x, name: t } : x)) }), true);
      }
      const prompt = target === "room" ? roomDesignPrompt(p) : furnitureDesignPrompt(p.furniture.find((x) => x.id === target)!, p);
      const d: Design = await makeDesign(settings, p.id, prompt, target === "room" ? DESIGN_SIZE.room : DESIGN_SIZE.furniture, ctrl.signal, say);
      // 前のデザインの画像は消さない(その画像を使った清書を作り直せるように)
      change((cur) => (target === "room" ? { ...cur, design: d } : { ...cur, furniture: cur.furniture.map((x) => (x.id === target ? { ...x, design: d } : x)) }), true);
      setDesigning(null);
    } catch (e) {
      setDesigning(null);
      setDesignError({ target, text: ctrl.signal.aborted ? "中断しました" : `デザインを作れませんでした:${message(e)}` });
    } finally {
      if (abort.current === ctrl) abort.current = null;
    }
  };

  const designBox = (target: string, value: Design | null) => (
    <div className="design-box">
      {value ? <PlaceImage placeId={place.id} file={value.file} /> : <div className="noimage">デザインなし</div>}
      <div className="row" style={{ marginBottom: 0 }}>
        {designing?.target === target ? (
          <button className="small" onClick={() => abort.current?.abort()}>
            中断
          </button>
        ) : (
          <button className="small" disabled={!!designing} onClick={() => void design(target)}>
            {value ? "デザインを作り直す" : "デザインを作る"}(ComfyUI)
          </button>
        )}
      </div>
      {designing?.target === target && <small className="status">{designing.text}</small>}
      {designError?.target === target && <small className="error">{designError.text}</small>}
      <small className="muted">説明から ComfyUI(MiniMax-H3-Image)で作ります(1枚に6分ほど)。直すと、この場所を使うすべての場面に効きます。</small>
    </div>
  );

  const remove = async () => {
    const ok = await ask(`「${place.title || "無題の場所"}」を削除しますか?(ライブラリの .trash に移します。この場所を使う場面は残ります)`, {
      title: "場所を削除",
      kind: "warning",
      okLabel: "削除",
      cancelLabel: "やめる",
    });
    if (!ok) return;
    window.clearTimeout(saveTimer.current);
    pending.current = null;
    await deletePlace(place.id);
    onBack();
  };

  const selO = selected?.kind === "opening" ? place.openings.find((o) => o.id === selected.id) : undefined;

  return (
    <div className="page wide">
      <header className="page-head">
        <button className="ghost" onClick={onBack}>
          ← 一覧
        </button>
        <input className="title-input" value={place.title} placeholder="場所の名前" onChange={(e) => change((p) => ({ ...p, title: e.target.value }))} />
        <span className="muted small-text">{saveState === "saving" ? "保存中…" : saveState === "error" ? "保存できませんでした" : "保存済み"}</span>
        <div className="grow" />
        <button className="small" onClick={() => void openPlaceFolder(place.id)}>
          フォルダーを開く
        </button>
        <button className="small" disabled={!!designing} onClick={() => void remove()}>
          削除
        </button>
      </header>

      <div className="editor">
        <div className="editor-side">
          <div className="tabs side-tabs">
            {(
              [
                ["room", "部屋"],
                ["openings", `窓・ドア(${place.openings.length})`],
                ["furniture", `家具(${place.furniture.length})`],
                ["check", `寸法の点検(${warnings.length})`],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>

          {tab === "room" && (
            <>
              <section className="card">
                <h3>間取り</h3>
                <CmInput label="天井の高さ(cm)" min={150} value={place.ceilingCm} onChange={(v) => change((p) => ({ ...p, ceilingCm: Math.min(600, Math.max(150, v)) }))} />
                <small className="muted">床の形は長方形の組み合わせです(L 字の部屋は2つ)。左上の角の位置と幅・奥行き(cm)。</small>
                {place.floor.map((r, i) => (
                  <div key={i} className="floor-rect">
                    <div className="two">
                      <CmInput label="左の位置" value={r.x} onChange={(v) => change((p) => ({ ...p, floor: p.floor.map((x, k) => (k === i ? { ...x, x: v } : x)) }))} />
                      <CmInput label="奥の位置" value={r.z} onChange={(v) => change((p) => ({ ...p, floor: p.floor.map((x, k) => (k === i ? { ...x, z: v } : x)) }))} />
                      <CmInput label="幅" min={30} value={r.width} onChange={(v) => change((p) => ({ ...p, floor: p.floor.map((x, k) => (k === i ? { ...x, width: Math.max(30, v) } : x)) }))} />
                      <CmInput label="奥行き" min={30} value={r.depth} onChange={(v) => change((p) => ({ ...p, floor: p.floor.map((x, k) => (k === i ? { ...x, depth: Math.max(30, v) } : x)) }))} />
                    </div>
                    {place.floor.length > 1 && (
                      <button className="small" onClick={() => change((p) => ({ ...p, floor: p.floor.filter((_, k) => k !== i) }))}>
                        この長方形を外す
                      </button>
                    )}
                  </div>
                ))}
                <button className="small" onClick={() => change((p) => ({ ...p, floor: [...p.floor, { x: bx1, z: bz0, width: 120, depth: 120 }] }))}>
                  長方形を足す(右に)
                </button>
              </section>
              <section className="card">
                <h3>部屋の説明とデザイン</h3>
                <label className="field">
                  <span>部屋の説明(日本語。壁・床・窓の外・明かりなど)</span>
                  <textarea rows={3} value={place.description.ja} placeholder="例:古いアパートの6畳の部屋。白い壁紙、フローリング、窓の外は住宅街" onChange={(e) => change((p) => ({ ...p, description: { ...p.description, ja: e.target.value } }))} />
                </label>
                <label className="field">
                  <span>部屋の説明(英語)</span>
                  <input className="en" value={place.description.en} onChange={(e) => change((p) => ({ ...p, description: { ...p.description, en: e.target.value } }))} />
                </label>
                <label className="field">
                  <span>画風(英語。部屋と家具のデザインの先頭に入ります。Euros と同じ選び方)</span>
                  <select
                    value={STYLE_PRESETS.findIndex((s) => s.en === place.style.trim())}
                    onChange={(e) => {
                      const i = Number(e.target.value);
                      if (i >= 0) change((p) => ({ ...p, style: STYLE_PRESETS[i].en }));
                    }}
                  >
                    {STYLE_PRESETS.map((s, i) => (
                      <option key={s.label} value={i}>
                        {s.label}
                      </option>
                    ))}
                    <option value={-1}>自由に書く</option>
                  </select>
                  <textarea className="en" rows={2} value={place.style} placeholder="空なら画風の行を入れません" onChange={(e) => change((p) => ({ ...p, style: e.target.value }))} />
                </label>
                <div className="row">
                  <button className="small" disabled={translating || !!designing} onClick={() => void translate()}>
                    {translating ? "英語にしています…" : "部屋と家具の説明を英語にする(Ollama)"}
                  </button>
                  {designError?.target === "translate" && <small className="error">{designError.text}</small>}
                </div>
                {designBox("room", place.design)}
              </section>
            </>
          )}

          {tab === "openings" && (
            <>
              <section className="card">
                <div className="row" style={{ marginBottom: 0 }}>
                  <span className="muted small-text">足す:</span>
                  {(Object.keys(OPENING_KINDS) as OpeningKind[]).map((k) => (
                    <button key={k} className="small" onClick={() => addOpening(k)}>
                      {OPENING_KINDS[k].label}
                    </button>
                  ))}
                </div>
                <small className="muted">間取り図でドラッグすると、壁の上を動きます。</small>
              </section>
              {place.openings.map((o) => (
                <section key={o.id} className={`card${selO?.id === o.id ? " selected-card" : ""}`} onClick={() => setSelected({ kind: "opening", id: o.id })}>
                  <h3>{OPENING_KINDS[o.kind].label}</h3>
                  <div className="two">
                    <CmInput label="幅(cm)" min={30} value={o.widthCm} onChange={(v) => change((p) => ({ ...p, openings: p.openings.map((x) => (x.id === o.id ? { ...x, widthCm: Math.max(30, v) } : x)) }))} />
                    <CmInput label="高さ(cm)" min={30} value={o.heightCm} onChange={(v) => change((p) => ({ ...p, openings: p.openings.map((x) => (x.id === o.id ? { ...x, heightCm: Math.max(30, v) } : x)) }))} />
                  </div>
                  {o.kind === "window" && (
                    <CmInput label="床から窓の下まで(cm)" min={0} value={o.sillCm} onChange={(v) => change((p) => ({ ...p, openings: p.openings.map((x) => (x.id === o.id ? { ...x, sillCm: Math.max(0, v) } : x)) }))} />
                  )}
                  {warnings
                    .filter((w) => w.target === o.id)
                    .map((w, i) => (
                      <div key={i} className="error small-text">
                        {w.text}
                      </div>
                    ))}
                  <button className="small" onClick={() => change((p) => ({ ...p, openings: p.openings.filter((x) => x.id !== o.id) }))}>
                    外す
                  </button>
                </section>
              ))}
            </>
          )}

          {tab === "furniture" && (
            <>
              <section className="card">
                <div className="row" style={{ marginBottom: 0 }}>
                  <span className="muted small-text">家具を足す:</span>
                  {(Object.keys(FURNITURE_KINDS) as FurnitureKind[]).map((k) => (
                    <button key={k} className="small" onClick={() => addFurniture(k)}>
                      {FURNITURE_KINDS[k].label}
                    </button>
                  ))}
                </div>
                <small className="muted">寸法は実際の大きさ(cm)です。間取り図でドラッグして置きます。太い線が正面です。</small>
                <div className="chips" style={{ marginTop: 8, marginBottom: 0 }}>
                  {place.furniture.map((f) => (
                    <button key={f.id} className={`chip${selF?.id === f.id ? " active" : ""}`} onClick={() => setSelected({ kind: "furniture", id: f.id })}>
                      <span className="swatch" style={{ background: hex(FURNITURE_COLORS[f.color % FURNITURE_COLORS.length].hex) }} />
                      {furnitureLabel(f)}
                      {warned.has(f.id) && " ⚠"}
                    </button>
                  ))}
                </div>
              </section>
              {selF && (
                <section className="card">
                  <h3>
                    <span className="swatch" style={{ background: hex(FURNITURE_COLORS[selF.color % FURNITURE_COLORS.length].hex) }} />
                    {FURNITURE_KINDS[selF.kind].label}
                  </h3>
                  <label className="field">
                    <span>見た目の説明(日本語)</span>
                    <input value={selF.name.ja} placeholder="例:木目の勉強机、上に古いモニター" onChange={(e) => setFurniture(selF.id, { name: { ...selF.name, ja: e.target.value } })} />
                  </label>
                  <label className="field">
                    <span>見た目の説明(英語)</span>
                    <input className="en" value={selF.name.en} onChange={(e) => setFurniture(selF.id, { name: { ...selF.name, en: e.target.value } })} />
                  </label>
                  <div className="two">
                    <CmInput label="幅(cm)" min={1} value={selF.widthCm} onChange={(v) => setFurniture(selF.id, { widthCm: Math.max(1, v) })} />
                    <CmInput label="奥行き(cm)" min={1} value={selF.depthCm} onChange={(v) => setFurniture(selF.id, { depthCm: Math.max(1, v) })} />
                    <CmInput label="高さ(cm)" min={1} value={selF.heightCm} onChange={(v) => setFurniture(selF.id, { heightCm: Math.max(1, v) })} />
                    {isSeat(selF) ? (
                      <CmInput label="座面の高さ(cm)" min={1} value={seatHeight(selF)} onChange={(v) => setFurniture(selF.id, { seatCm: Math.max(1, v) })} />
                    ) : (
                      <CmInput label="床から浮かせる(cm)" min={0} value={selF.elevationCm ?? 0} onChange={(v) => setFurniture(selF.id, { elevationCm: Math.max(0, v) })} />
                    )}
                    <CmInput label="左右の位置(cm)" value={selF.x} onChange={(v) => setFurniture(selF.id, { x: v })} />
                    <CmInput label="前後の位置(cm)" value={selF.z} onChange={(v) => setFurniture(selF.id, { z: v })} />
                  </div>
                  <label className="slider">
                    <span>
                      向き<b>{selF.rotation}°</b>
                    </span>
                    <input type="range" min={-180} max={180} step={5} value={selF.rotation} onChange={(e) => setFurniture(selF.id, { rotation: Number(e.target.value) })} />
                  </label>
                  <div className="row">
                    <button className="small" onClick={() => setFurniture(selF.id, { rotation: ((((selF.rotation + 90 + 180) % 360) + 360) % 360) - 180 })}>
                      90°回す
                    </button>
                    <label className="check">
                      色
                      <select value={selF.color} style={{ width: "auto" }} onChange={(e) => setFurniture(selF.id, { color: Number(e.target.value) })}>
                        {FURNITURE_COLORS.map((c, i) => (
                          <option key={i} value={i}>
                            {c.label}
                            {place.furniture.some((f) => f.id !== selF.id && f.color === i) ? "(使用中)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {warnings
                    .filter((w) => w.target === selF.id)
                    .map((w, i) => (
                      <div key={i} className="error small-text">
                        {w.text}
                      </div>
                    ))}
                  {designBox(selF.id, selF.design)}
                  <button
                    className="small"
                    onClick={() => {
                      change((p) => ({ ...p, furniture: p.furniture.filter((f) => f.id !== selF.id) }));
                      setSelected(null);
                    }}
                  >
                    この家具を外す
                  </button>
                </section>
              )}
            </>
          )}

          {tab === "check" && (
            <section className="card">
              <h3>寸法の点検</h3>
              {warnings.length === 0 ? (
                <p className="muted small-text" style={{ margin: 0 }}>
                  問題は見つかりませんでした(部屋に入らない・壁や他の家具にめり込む・ドアや窓をふさぐ・ありえない寸法を調べます)。
                </p>
              ) : (
                <ul className="warnings">
                  {warnings.map((w, i) => (
                    <li key={i}>
                      <button
                        className="link"
                        onClick={() => {
                          const isF = place.furniture.some((f) => f.id === w.target);
                          setSelected({ kind: isF ? "furniture" : "opening", id: w.target });
                          setTab(isF ? "furniture" : "openings");
                        }}
                      >
                        {w.text}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        <div className="editor-main place-main">
          <PlanView
            place={place}
            selected={selected}
            warned={warned}
            onSelect={(p) => {
              setSelected(p);
              if (p) setTab(p.kind === "furniture" ? "furniture" : "openings");
            }}
            onMoveFurniture={(fid, x, z) => setFurniture(fid, { x, z })}
            onMoveOpening={moveOpening}
          />
          <small className="muted">間取り図(上から見た図。目盛りは50cm)。家具・窓・ドアをドラッグで動かす。点線は寸法の点検で警告のある物です。</small>
          <Viewport
            state={stage}
            selected={null}
            camera={camera}
            aspect={4 / 3}
            maxHeight={420}
            onCamera={setCamera}
            onSelect={() => undefined}
            onMovePerson={() => undefined}
            onSelectCreature={() => undefined}
            onMoveCreature={() => undefined}
            onLimb={() => undefined}
          />
          <small className="muted">3D(ドラッグで回す・Shift で高さ・Ctrl で平行移動・ホイールで近づける)。手前の壁は写りません。</small>
        </div>
      </div>
    </div>
  );
}
