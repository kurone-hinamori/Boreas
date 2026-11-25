import { useCallback, useEffect, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { CharacterSummary, Settings } from "../types";
import { FIGURES, type FigureId, PERSON_COLORS } from "../lib/figures";
import { POSES, type PoseId } from "../lib/poses";
import { type EurosCharacter, FRAMES, type FrameId, personFrom, type Scene, type ScenePerson } from "../lib/scene";
import type { StageCamera } from "../lib/stage";
import { deleteScene, listEurosCharacters, loadEurosCharacter, loadScene, openSceneFolder, saveScene } from "../lib/storage";
import { Viewport, type ViewportHandle } from "./Viewport";
import { RefinePanel } from "./RefinePanel";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Slider(props: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span>
        {props.label}
        <b>
          {props.value}
          {props.unit}
        </b>
      </span>
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
    </label>
  );
}

/** 枠に人物を収めるカメラ。extent は写す縦の長さ(身長に対する割合)、center はその中心の高さ */
function framing(camera: StageCamera, heightM: number, extent: number, center: number): StageCamera {
  const half = (heightM * extent) / 2;
  const distance = (half / Math.tan((camera.fov * Math.PI) / 360)) * 1.08;
  return { ...camera, distance: Math.round(distance * 100) / 100, targetY: Math.round(heightM * center * 100) / 100 };
}

export function SceneEditor({ id, settings, onBack }: { id: string; settings: Settings; onBack: () => void }) {
  const [scene, setScene] = useState<Scene | null>(null);
  const [error, setError] = useState("");
  const [characters, setCharacters] = useState<Record<string, EurosCharacter>>({});
  const [eurosList, setEurosList] = useState<CharacterSummary[]>([]);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const viewport = useRef<ViewportHandle>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const pending = useRef<Scene | null>(null);

  useEffect(() => {
    loadScene(id)
      .then(async (s) => {
        setScene(s);
        const loaded = await Promise.all(s.people.map((p) => loadEurosCharacter(p.characterId).catch(() => null)));
        setCharacters(Object.fromEntries(loaded.filter((c): c is EurosCharacter => !!c).map((c) => [c.id, c])));
      })
      .catch((e) => setError(message(e)));
    listEurosCharacters()
      .then(setEurosList)
      .catch(() => undefined);
  }, [id]);

  const flush = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    const s = pending.current;
    if (!s) return;
    pending.current = null;
    setSaveState("saving");
    try {
      await saveScene(s);
      setSaveState(pending.current ? "saving" : "saved");
    } catch {
      setSaveState("error");
    }
  }, []);

  // 画面を離れるときに、保存していない変更を書く
  useEffect(() => () => void flush(), [flush]);

  /** 場面を変えて、少し待ってから保存する(スライダーを動かすたびに書かないように) */
  const change = useCallback(
    (fn: (s: Scene) => Scene, immediate = false) => {
      setScene((prev) => {
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

  if (error) {
    return (
      <div className="page">
        <p className="error">場面を読み込めませんでした:{error}</p>
        <button onClick={onBack}>一覧に戻る</button>
      </div>
    );
  }
  if (!scene) return <div className="page muted">読み込み中…</div>;

  const person = scene.people[0] as ScenePerson | undefined;
  const setPerson = (patch: Partial<ScenePerson>) => change((s) => ({ ...s, people: s.people.map((p, i) => (i === 0 ? { ...p, ...patch } : p)) }));
  const setCamera = (c: StageCamera) => change((s) => ({ ...s, camera: c }));

  const chooseCharacter = async (characterId: string) => {
    if (!characterId) {
      change((s) => ({ ...s, people: [] }));
      return;
    }
    try {
      const c = await loadEurosCharacter(characterId);
      setCharacters((m) => ({ ...m, [c.id]: c }));
      const next = personFrom(c, 0);
      // 置き換えるときは、立ち位置・ポーズ・動作は引き継ぐ
      change((s) => ({ ...s, people: [s.people[0] ? { ...s.people[0], ...pick(next) } : next] }));
    } catch (e) {
      setError(message(e));
    }
  };

  const remove = async () => {
    const ok = await ask(`「${scene.title || "無題の場面"}」を削除しますか?(ライブラリの .trash に移します)`, { title: "場面を削除", kind: "warning", okLabel: "削除", cancelLabel: "やめる" });
    if (!ok) return;
    window.clearTimeout(saveTimer.current);
    pending.current = null;
    await deleteScene(scene.id);
    onBack();
  };

  const frame = FRAMES[scene.frame];
  const heightM = (person?.heightCm ?? 160) / 100;

  return (
    <div className="page wide">
      <header className="page-head">
        <button className="ghost" onClick={onBack}>
          ← 一覧
        </button>
        <input className="title-input" value={scene.title} placeholder="場面の名前" onChange={(e) => change((s) => ({ ...s, title: e.target.value }))} />
        <span className="muted small-text">{saveState === "saving" ? "保存中…" : saveState === "error" ? "保存できませんでした" : "保存済み"}</span>
        <div className="grow" />
        <button className="small" onClick={() => void openSceneFolder(scene.id)}>
          フォルダーを開く
        </button>
        <button className="small" onClick={() => void remove()}>
          削除
        </button>
      </header>

      <div className="editor">
        <div className="editor-side">
          <section className="card">
            <h3>人物</h3>
            <label className="field">
              <span>Euros のキャラクター</span>
              <select value={person?.characterId ?? ""} onChange={(e) => void chooseCharacter(e.target.value)}>
                <option value="">(選ばない)</option>
                {eurosList.map((c) => (
                  <option key={c.id} value={c.id} disabled={!c.sheet}>
                    {c.name || "(名前なし)"}
                    {!c.sheet && "(シートなし)"}
                  </option>
                ))}
              </select>
            </label>
            {person && (
              <>
                <div className="row" style={{ marginBottom: 8 }}>
                  <span className="swatch" style={{ background: `#${PERSON_COLORS[person.color].hex.toString(16).padStart(6, "0")}` }} />
                  <small className="muted">下絵ではこの色の素体になります。</small>
                </div>
                <div className="two">
                  <label className="field">
                    <span>素体</span>
                    <select value={person.figure} onChange={(e) => setPerson({ figure: e.target.value as FigureId })}>
                      {FIGURES.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>身長(cm)</span>
                    <input type="number" min={80} max={250} value={person.heightCm} onChange={(e) => setPerson({ heightCm: Math.min(250, Math.max(80, Number(e.target.value) || 160)) })} />
                  </label>
                </div>
              </>
            )}
          </section>

          {person && (
            <section className="card">
              <h3>ポーズ</h3>
              <div className="poses">
                {POSES.map((p) => (
                  <button key={p.id} className={`small${person.pose === p.id ? " active" : ""}`} onClick={() => setPerson({ pose: p.id as PoseId })}>
                    {p.label}
                  </button>
                ))}
              </div>
              <Slider label="体の向き" unit="°" value={person.rotation} min={-180} max={180} step={5} onChange={(v) => setPerson({ rotation: v })} />
              <Slider label="顔の左右" unit="°" value={person.headYaw} min={-70} max={70} step={5} onChange={(v) => setPerson({ headYaw: v })} />
              <Slider label="顔の上下(+で下)" unit="°" value={person.headPitch} min={-40} max={40} step={5} onChange={(v) => setPerson({ headPitch: v })} />
              <label className="field">
                <span>動作(ポーズに足す細かい動き。日本語)</span>
                <input value={person.action.ja} placeholder="例:バットを肩に担いでいる" onChange={(e) => setPerson({ action: { ...person.action, ja: e.target.value } })} />
              </label>
              <label className="field">
                <span>表情(日本語)</span>
                <input value={person.expression.ja} placeholder="例:気だるげに睨む" onChange={(e) => setPerson({ expression: { ...person.expression, ja: e.target.value } })} />
              </label>
            </section>
          )}

          <section className="card">
            <h3>カメラと枠</h3>
            <label className="field">
              <span>枠</span>
              <select value={scene.frame} onChange={(e) => change((s) => ({ ...s, frame: e.target.value as FrameId }))}>
                {Object.entries(FRAMES).map(([k, f]) => (
                  <option key={k} value={k}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="row">
              <button className="small" onClick={() => setCamera(framing(scene.camera, heightM, 1.12, 0.5))}>
                全身
              </button>
              <button className="small" onClick={() => setCamera(framing(scene.camera, heightM, 0.72, 0.64))}>
                膝上
              </button>
              <button className="small" onClick={() => setCamera(framing(scene.camera, heightM, 0.42, 0.8))}>
                胸上
              </button>
            </div>
            <Slider label="回り込み" unit="°" value={scene.camera.yaw} min={-180} max={180} step={1} onChange={(v) => setCamera({ ...scene.camera, yaw: v })} />
            <Slider label="見下ろす角度(-で煽り)" unit="°" value={scene.camera.pitch} min={-60} max={80} step={1} onChange={(v) => setCamera({ ...scene.camera, pitch: v })} />
            <Slider label="距離" unit="m" value={scene.camera.distance} min={0.5} max={15} step={0.05} onChange={(v) => setCamera({ ...scene.camera, distance: v })} />
            <Slider label="注視点の高さ" unit="m" value={scene.camera.targetY} min={-0.5} max={3} step={0.01} onChange={(v) => setCamera({ ...scene.camera, targetY: v })} />
            <Slider label="画角" unit="°" value={scene.camera.fov} min={15} max={80} step={1} onChange={(v) => setCamera({ ...scene.camera, fov: v })} />
          </section>
        </div>

        <div className="editor-main">
          <Viewport ref={viewport} people={scene.people} camera={scene.camera} aspect={frame.width / frame.height} onCamera={setCamera} />
          <small className="muted">ドラッグでカメラを回す・Shift+ドラッグで高さ・ホイールで近づける。白い背景と床は清書では描かれません。</small>
        </div>
      </div>

      <RefinePanel scene={scene} characters={characters} settings={settings} viewport={viewport} change={change} flush={flush} />
    </div>
  );
}

/** キャラクターを選び直したときに、新しいキャラクターから取る項目 */
function pick(p: ScenePerson): Partial<ScenePerson> {
  const { characterId, revisionId, name, figure, heightCm } = p;
  return { characterId, revisionId, name, figure, heightCm };
}
