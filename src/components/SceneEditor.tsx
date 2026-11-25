import { useCallback, useEffect, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { CharacterSummary, Settings } from "../types";
import { BODY_PARTS, type BodyPart, FIGURES, type FigureId, HAND_SHAPES, type HandShape, LIMBS, type LimbId, PERSON_COLORS } from "../lib/figures";
import { POSES, type PoseId } from "../lib/poses";
import { PROP_COLORS, PROP_KINDS, type PropKind } from "../lib/props";
import {
  emptyText,
  type EurosCharacter,
  FRAMES,
  type FrameId,
  freeColor,
  MAX_PEOPLE,
  newId,
  normalizeScene,
  personFrom,
  removePerson,
  removeProp,
  type Scene,
  type SceneContact,
  type ScenePerson,
  type SceneProp,
} from "../lib/scene";
import type { ContactFrom, Gaze, StageCamera } from "../lib/stage";
import { deleteScene, listEurosCharacters, loadEurosCharacter, loadScene, openSceneFolder, saveScene } from "../lib/storage";
import { Viewport, type ViewportHandle } from "./Viewport";
import { RefinePanel } from "./RefinePanel";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

function Slider(props: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span>
        {props.label}
        <b>
          {Math.round(props.value * 100) / 100}
          {props.unit}
        </b>
      </span>
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
    </label>
  );
}

/** 人物の色の印と名前 */
function Who({ p }: { p: ScenePerson }) {
  return (
    <>
      <span className="swatch" style={{ background: hex(PERSON_COLORS[p.color % PERSON_COLORS.length].hex) }} />
      {p.name}
    </>
  );
}

/** 枠に人物を収めるカメラ。extent は写す縦の長さ(身長に対する割合)、center はその中心の高さ */
function framing(scene: Scene, extent: number, center: number): StageCamera {
  const c = scene.camera;
  const people = scene.people.length ? scene.people : [{ x: 0, z: 0, heightCm: 160 }];
  const h = Math.max(...people.map((p) => p.heightCm)) / 100;
  const xs = people.map((p) => p.x);
  const zs = people.map((p) => p.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + 0.6;
  const frame = FRAMES[scene.frame];
  const vHalf = Math.tan((c.fov * Math.PI) / 360);
  const hHalf = vHalf * (frame.width / frame.height);
  const distance = Math.max(((h * extent) / 2 / vHalf) * 1.08, (spread / 2 / hHalf) * 1.1);
  const r = (v: number) => Math.round(v * 100) / 100;
  return { ...c, distance: r(distance), targetY: r(h * center), targetX: r(cx), targetZ: r(cz) };
}

type Tab = "people" | "props" | "contacts" | "camera";

export function SceneEditor({ id, settings, onBack }: { id: string; settings: Settings; onBack: () => void }) {
  const [scene, setScene] = useState<Scene | null>(null);
  const [error, setError] = useState("");
  const [characters, setCharacters] = useState<Record<string, EurosCharacter>>({});
  const [eurosList, setEurosList] = useState<CharacterSummary[]>([]);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("people");
  const viewport = useRef<ViewportHandle>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const pending = useRef<Scene | null>(null);

  useEffect(() => {
    loadScene(id)
      .then(async (raw) => {
        const s = normalizeScene(raw);
        setScene(s);
        setSelected(s.people.length ? 0 : null);
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

  const sel = selected !== null ? scene.people[selected] : undefined;
  const setPersonAt = (i: number, patch: Partial<ScenePerson>) => change((s) => ({ ...s, people: s.people.map((p, k) => (k === i ? { ...p, ...patch } : p)) }));
  const setPerson = (patch: Partial<ScenePerson>) => selected !== null && setPersonAt(selected, patch);
  const setCamera = (c: StageCamera) => change((s) => ({ ...s, camera: c }));
  const setProp = (i: number, patch: Partial<SceneProp>) => change((s) => ({ ...s, props: s.props.map((p, k) => (k === i ? { ...p, ...patch } : p)) }));

  const loadCharacter = async (characterId: string) => {
    const c = await loadEurosCharacter(characterId);
    setCharacters((m) => ({ ...m, [c.id]: c }));
    return c;
  };

  const addPerson = async (characterId: string) => {
    if (!characterId || scene.people.length >= MAX_PEOPLE) return;
    try {
      const c = await loadCharacter(characterId);
      change((s) => {
        const p = personFrom(c, freeColor(s.people.map((x) => x.color), PERSON_COLORS.length));
        // 2人目からは、横に並べて互いに向き合わせる
        const n = s.people.length;
        const placed = n === 0 ? p : { ...p, x: n % 2 ? 0.7 * Math.ceil(n / 2) : -0.7 * Math.ceil(n / 2), rotation: n % 2 ? -60 : 60 };
        return { ...s, people: [...s.people, placed] };
      });
      setSelected(scene.people.length);
    } catch (e) {
      setError(message(e));
    }
  };

  const replaceCharacter = async (characterId: string) => {
    if (selected === null || !characterId) return;
    try {
      const c = await loadCharacter(characterId);
      const next = personFrom(c, scene.people[selected].color);
      setPerson({ characterId: next.characterId, revisionId: next.revisionId, name: next.name, figure: next.figure, heightCm: next.heightCm });
    } catch (e) {
      setError(message(e));
    }
  };

  const deletePerson = () => {
    if (selected === null) return;
    change((s) => removePerson(s, selected));
    setSelected(scene.people.length > 1 ? 0 : null);
  };

  const addProp = (kind: PropKind) => {
    const def = PROP_KINDS[kind];
    const prop: SceneProp = {
      id: newId(),
      kind,
      ...def.size,
      grip: def.long ? 0.12 : 0.5,
      color: freeColor(scene.props.map((p) => p.color), PROP_COLORS.length),
      // 人物を選んでいれば右手に持たせる。長くない物は床に置く
      holder: def.long && selected !== null ? { person: selected, side: "r" } : null,
      x: 0.4,
      z: 0.3,
      yaw: 0,
      pitch: def.long ? 60 : 0,
      name: emptyText(),
    };
    change((s) => ({ ...s, props: [...s.props, prop] }));
  };

  const addContact = () => {
    const from: ContactFrom = { kind: "hand", person: selected ?? 0, side: "r" };
    const other = scene.people.findIndex((_, i) => i !== (selected ?? 0));
    const contact: SceneContact = { id: newId(), from, to: { person: other >= 0 ? other : 0, part: "shoulder_l" } };
    change((s) => ({ ...s, contacts: [...s.contacts, contact] }));
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
  // 触れる点の「誰の・どこから」の選択肢
  const fromOptions: { key: string; label: string; value: ContactFrom }[] = [
    ...scene.people.flatMap((p, i) =>
      (["r", "l"] as const).map((side) => ({ key: `h${i}${side}`, label: `${p.name}の${side === "r" ? "右手" : "左手"}`, value: { kind: "hand" as const, person: i, side } })),
    ),
    ...scene.props.flatMap((pr, k) => (PROP_KINDS[pr.kind].long ? [{ key: `p${k}`, label: `${pr.name.ja || PROP_KINDS[pr.kind].label}の先`, value: { kind: "prop" as const, prop: k } }] : [])),
  ];
  const fromKey = (f: ContactFrom) => (f.kind === "hand" ? `h${f.person}${f.side}` : `p${f.prop}`);
  const gazeKey = (g: Gaze | undefined) => (!g || g.kind === "manual" ? "manual" : g.kind === "camera" ? "camera" : `p${g.index}`);

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
          <div className="tabs side-tabs">
            {(
              [
                ["people", `人物(${scene.people.length})`],
                ["props", `小物(${scene.props.length})`],
                ["contacts", `触れる(${scene.contacts.length})`],
                ["camera", "カメラ"],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>

          {tab === "people" && (
            <>
              <section className="card">
                <div className="chips">
                  {scene.people.map((p, i) => (
                    <button key={i} className={`chip${selected === i ? " active" : ""}`} onClick={() => setSelected(i)}>
                      <Who p={p} />
                    </button>
                  ))}
                </div>
                {scene.people.length < MAX_PEOPLE ? (
                  <label className="field" style={{ marginBottom: 0 }}>
                    <span>人物を足す(Euros のキャラクター。最大{MAX_PEOPLE}人)</span>
                    <select value="" onChange={(e) => void addPerson(e.target.value)}>
                      <option value="">(選ぶ)</option>
                      {eurosList.map((c) => (
                        <option key={c.id} value={c.id} disabled={!c.sheet}>
                          {c.name || "(名前なし)"}
                          {!c.sheet && "(シートなし)"}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <small className="muted">これ以上は足せません(最大{MAX_PEOPLE}人)。</small>
                )}
              </section>

              {sel && selected !== null && (
                <>
                  <section className="card">
                    <h3>
                      <Who p={sel} />
                    </h3>
                    <label className="field">
                      <span>Euros のキャラクター</span>
                      <select value={sel.characterId} onChange={(e) => void replaceCharacter(e.target.value)}>
                        {eurosList.map((c) => (
                          <option key={c.id} value={c.id} disabled={!c.sheet}>
                            {c.name || "(名前なし)"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="two">
                      <label className="field">
                        <span>素体</span>
                        <select value={sel.figure} onChange={(e) => setPerson({ figure: e.target.value as FigureId })}>
                          {FIGURES.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>身長(cm)</span>
                        <input type="number" min={80} max={250} value={sel.heightCm} onChange={(e) => setPerson({ heightCm: Math.min(250, Math.max(80, Number(e.target.value) || 160)) })} />
                      </label>
                    </div>
                    <div className="two">
                      <Slider label="左右の位置" unit="m" value={sel.x} min={-3} max={3} step={0.01} onChange={(v) => setPerson({ x: v })} />
                      <Slider label="前後の位置" unit="m" value={sel.z} min={-3} max={3} step={0.01} onChange={(v) => setPerson({ z: v })} />
                    </div>
                    <Slider label="体の向き" unit="°" value={sel.rotation} min={-180} max={180} step={5} onChange={(v) => setPerson({ rotation: v })} />
                    <small className="muted">3D の表示で人物をドラッグしても動かせます。</small>
                  </section>

                  <section className="card">
                    <h3>ポーズ</h3>
                    <div className="poses">
                      {POSES.map((p) => (
                        <button key={p.id} className={`small${sel.pose === p.id ? " active" : ""}`} onClick={() => setPerson({ pose: p.id as PoseId, ik: {} })}>
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <div className="row" style={{ marginBottom: 8 }}>
                      <small className="muted">黒い点(手足の先)をドラッグすると、腕や脚を伸ばす向きを変えられます。</small>
                      {Object.keys(sel.ik ?? {}).length > 0 && (
                        <button className="small" onClick={() => setPerson({ ik: {} })}>
                          {(Object.keys(sel.ik ?? {}) as LimbId[]).map((l) => LIMBS[l].label).join("・")}を戻す
                        </button>
                      )}
                    </div>
                    <div className="two">
                      {(["r", "l"] as const).map((side) => (
                        <label key={side} className="field">
                          <span>{side === "r" ? "右手" : "左手"}の形</span>
                          <select value={sel.hands?.[side] ?? "auto"} onChange={(e) => setPerson({ hands: { l: "auto", r: "auto", ...sel.hands, [side]: e.target.value as HandShape } })}>
                            {HAND_SHAPES.map((h) => (
                              <option key={h.id} value={h.id}>
                                {h.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                    <label className="field">
                      <span>視線</span>
                      <select
                        value={gazeKey(sel.gaze)}
                        onChange={(e) => {
                          const v = e.target.value;
                          setPerson({ gaze: v === "manual" ? { kind: "manual" } : v === "camera" ? { kind: "camera" } : { kind: "person", index: Number(v.slice(1)) } });
                        }}
                      >
                        <option value="manual">顔の向きで決める</option>
                        <option value="camera">カメラを見る</option>
                        {scene.people.map((p, i) =>
                          i === selected ? null : (
                            <option key={i} value={`p${i}`}>
                              {p.name}を見る
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    {gazeKey(sel.gaze) === "manual" && (
                      <>
                        <Slider label="顔の左右" unit="°" value={sel.headYaw} min={-70} max={70} step={5} onChange={(v) => setPerson({ headYaw: v })} />
                        <Slider label="顔の上下(+で下)" unit="°" value={sel.headPitch} min={-40} max={40} step={5} onChange={(v) => setPerson({ headPitch: v })} />
                      </>
                    )}
                    <label className="field">
                      <span>動作(ポーズに足す細かい動き。日本語)</span>
                      <input value={sel.action.ja} placeholder="例:相手の胸にバットを突きつける" onChange={(e) => setPerson({ action: { ...sel.action, ja: e.target.value } })} />
                    </label>
                    <label className="field">
                      <span>表情(日本語)</span>
                      <input value={sel.expression.ja} placeholder="例:気だるげに睨む" onChange={(e) => setPerson({ expression: { ...sel.expression, ja: e.target.value } })} />
                    </label>
                    <button className="small" onClick={deletePerson}>
                      この人物を場面から外す
                    </button>
                  </section>
                </>
              )}
            </>
          )}

          {tab === "props" && (
            <>
              <section className="card">
                <div className="row" style={{ marginBottom: 0 }}>
                  <span className="muted small-text">小物を足す:</span>
                  {(Object.keys(PROP_KINDS) as PropKind[]).map((k) => (
                    <button key={k} className="small" onClick={() => addProp(k)}>
                      {PROP_KINDS[k].label}
                    </button>
                  ))}
                </div>
                <small className="muted">寸法は実際の大きさ(cm)です。長い物は、選んでいる人物の右手に持たせます。</small>
              </section>
              {scene.props.map((pr, k) => {
                const long = PROP_KINDS[pr.kind].long;
                const holderKey = pr.holder ? `${pr.holder.person}${pr.holder.side}` : "floor";
                return (
                  <section key={pr.id} className="card">
                    <h3>
                      <span className="swatch" style={{ background: hex(PROP_COLORS[pr.color % PROP_COLORS.length].hex) }} />
                      {PROP_KINDS[pr.kind].label}
                    </h3>
                    <label className="field">
                      <span>見た目(日本語)</span>
                      <input value={pr.name.ja} placeholder="例:銀色の金属バット" onChange={(e) => setProp(k, { name: { ...pr.name, ja: e.target.value } })} />
                    </label>
                    <div className="two">
                      <label className="field">
                        <span>{long ? "長さ" : pr.kind === "ball" ? "直径" : "幅"}(cm)</span>
                        <input type="number" min={1} value={pr.lengthCm} onChange={(e) => setProp(k, { lengthCm: Math.max(1, Number(e.target.value) || 1) })} />
                      </label>
                      {pr.kind !== "ball" && (
                        <label className="field">
                          <span>{long ? "太さ" : "奥行き"}(cm)</span>
                          <input type="number" min={0.5} value={pr.widthCm} onChange={(e) => setProp(k, { widthCm: Math.max(0.5, Number(e.target.value) || 1) })} />
                        </label>
                      )}
                    </div>
                    {pr.kind === "box" && (
                      <label className="field">
                        <span>高さ(cm)</span>
                        <input type="number" min={1} value={pr.heightCm} onChange={(e) => setProp(k, { heightCm: Math.max(1, Number(e.target.value) || 1) })} />
                      </label>
                    )}
                    {long && (
                      <label className="field">
                        <span>持つ人</span>
                        <select
                          value={holderKey}
                          onChange={(e) => {
                            const v = e.target.value;
                            setProp(k, { holder: v === "floor" ? null : { person: Number(v[0]), side: v[1] as "l" | "r" } });
                          }}
                        >
                          <option value="floor">床に置く</option>
                          {scene.people.flatMap((p, i) =>
                            (["r", "l"] as const).map((side) => (
                              <option key={`${i}${side}`} value={`${i}${side}`}>
                                {p.name}の{side === "r" ? "右手" : "左手"}
                              </option>
                            )),
                          )}
                        </select>
                      </label>
                    )}
                    {long && pr.holder && <Slider label="持つ位置(根元から)" value={pr.grip} min={0} max={0.9} step={0.01} onChange={(v) => setProp(k, { grip: v })} />}
                    {(!pr.holder || !long) && (
                      <div className="two">
                        <Slider label="左右の位置" unit="m" value={pr.x} min={-3} max={3} step={0.01} onChange={(v) => setProp(k, { x: v })} />
                        <Slider label="前後の位置" unit="m" value={pr.z} min={-3} max={3} step={0.01} onChange={(v) => setProp(k, { z: v })} />
                      </div>
                    )}
                    <Slider label={pr.holder ? "向き(左右。人物から見て)" : "向き"} unit="°" value={pr.yaw} min={-180} max={180} step={5} onChange={(v) => setProp(k, { yaw: v })} />
                    {long && <Slider label="向き(上下)" unit="°" value={pr.pitch} min={-90} max={90} step={5} onChange={(v) => setProp(k, { pitch: v })} />}
                    {scene.contacts.some((c) => c.from.kind === "prop" && c.from.prop === k) && <small className="muted">触れる点があるので、先は相手に向きます。</small>}
                    <div>
                      <button className="small" onClick={() => change((s) => removeProp(s, k))}>
                        外す
                      </button>
                    </div>
                  </section>
                );
              })}
            </>
          )}

          {tab === "contacts" && (
            <>
              <section className="card">
                <button className="small" disabled={!scene.people.length} onClick={addContact}>
                  触れる点を足す
                </button>
                <p className="muted small-text" style={{ marginBottom: 0 }}>
                  手や小物の先を、相手の体に寄せます。触れる点には黒い印を描き、プロンプトでも伝えます。
                </p>
              </section>
              {scene.contacts.map((c, k) => (
                <section key={c.id} className="card">
                  <label className="field">
                    <span>触れるもの</span>
                    <select
                      value={fromKey(c.from)}
                      onChange={(e) => {
                        const o = fromOptions.find((x) => x.key === e.target.value);
                        if (o) change((s) => ({ ...s, contacts: s.contacts.map((x, i) => (i === k ? { ...x, from: o.value } : x)) }));
                      }}
                    >
                      {fromOptions.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="two">
                    <label className="field">
                      <span>相手</span>
                      <select value={c.to.person} onChange={(e) => change((s) => ({ ...s, contacts: s.contacts.map((x, i) => (i === k ? { ...x, to: { ...x.to, person: Number(e.target.value) } } : x)) }))}>
                        {scene.people.map((p, i) => (
                          <option key={i} value={i}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>部位</span>
                      <select value={c.to.part} onChange={(e) => change((s) => ({ ...s, contacts: s.contacts.map((x, i) => (i === k ? { ...x, to: { ...x.to, part: e.target.value as BodyPart } } : x)) }))}>
                        {(Object.keys(BODY_PARTS) as BodyPart[]).map((part) => (
                          <option key={part} value={part}>
                            {BODY_PARTS[part].label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <button className="small" onClick={() => change((s) => ({ ...s, contacts: s.contacts.filter((_, i) => i !== k) }))}>
                    外す
                  </button>
                </section>
              ))}
            </>
          )}

          {tab === "camera" && (
            <section className="card">
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
                <button className="small" onClick={() => setCamera(framing(scene, 1.12, 0.5))}>
                  全身
                </button>
                <button className="small" onClick={() => setCamera(framing(scene, 0.72, 0.64))}>
                  膝上
                </button>
                <button className="small" onClick={() => setCamera(framing(scene, 0.42, 0.8))}>
                  胸上
                </button>
              </div>
              <Slider label="回り込み" unit="°" value={scene.camera.yaw} min={-180} max={180} step={1} onChange={(v) => setCamera({ ...scene.camera, yaw: v })} />
              <Slider label="見下ろす角度(-で煽り)" unit="°" value={scene.camera.pitch} min={-60} max={80} step={1} onChange={(v) => setCamera({ ...scene.camera, pitch: v })} />
              <Slider label="距離" unit="m" value={scene.camera.distance} min={0.5} max={15} step={0.05} onChange={(v) => setCamera({ ...scene.camera, distance: v })} />
              <Slider label="注視点の高さ" unit="m" value={scene.camera.targetY} min={-0.5} max={3} step={0.01} onChange={(v) => setCamera({ ...scene.camera, targetY: v })} />
              <Slider label="画角" unit="°" value={scene.camera.fov} min={15} max={80} step={1} onChange={(v) => setCamera({ ...scene.camera, fov: v })} />
              <small className="muted">何もない所をドラッグで回す・Shift+ドラッグで高さ・Ctrl+ドラッグで平行移動・ホイールで近づける。</small>
            </section>
          )}
        </div>

        <div className="editor-main">
          <Viewport
            ref={viewport}
            state={scene}
            selected={selected}
            camera={scene.camera}
            aspect={frame.width / frame.height}
            onCamera={setCamera}
            onSelect={(i) => {
              setSelected(i);
              if (i !== null) setTab("people");
            }}
            onMovePerson={(i, x, z) => setPersonAt(i, { x, z })}
            onLimb={(i, limb, pos) => change((s) => ({ ...s, people: s.people.map((p, k) => (k === i ? { ...p, ik: { ...p.ik, [limb]: pos } } : p)) }))}
          />
          <small className="muted">人物をクリックで選び、ドラッグで動かす。白い背景・床・黒い点は清書では描かれません。</small>
        </div>
      </div>

      <RefinePanel scene={scene} characters={characters} settings={settings} viewport={viewport} change={change} flush={flush} />
    </div>
  );
}
