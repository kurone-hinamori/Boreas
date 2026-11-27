import { useCallback, useEffect, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { CharacterSummary, Settings } from "../types";
import { BODY_PARTS, type BodyPart, FIGURES, type FigureId, HAND_SHAPES, type HandShape, LIMBS, type LimbId, PERSON_COLORS } from "../lib/figures";
import { POSES, type PoseId } from "../lib/poses";
import { equipmentImage, equipmentName, equipmentShape, type EurosEquipment, PROP_COLORS, PROP_KINDS, type PropKind } from "../lib/props";
import {
  CREATURE_FORMS,
  CREATURE_PARTS,
  type CreatureForm,
  type CreatureJoints,
  type CreaturePart,
  creatureTop,
  type Exaggeration,
  isExaggerated,
  NO_EXAGGERATION,
  partsOf,
  sizeLabel,
  STANCES,
  type Stance,
} from "../lib/creatures";
import {
  changeForm,
  creatureFrom,
  describe,
  emptyText,
  type EurosCharacter,
  FRAMES,
  type FrameId,
  freeColor,
  MAX_CHARACTERS,
  newId,
  normalizeScene,
  personFrom,
  removeCreature,
  removePerson,
  removeProp,
  type Scene,
  type SceneContact,
  type SceneCreature,
  type ScenePerson,
  type SceneProp,
  usedColors,
} from "../lib/scene";
import { type ContactFrom, type ContactTo, type Gaze, isCreatureTarget, type StageCamera } from "../lib/stage";
import { estimateBody } from "../lib/ollama";
import { deleteScene, listEurosCharacters, listEurosEquipment, loadEurosCharacter, loadScene, openSceneFolder, saveScene } from "../lib/storage";
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

/** 誇張の倍率(全体・長さ・太さ)。誇張しているときは印を出す */
function ScaleEditor({ value, onChange, lengthLabel = "長さ", widthLabel = "太さ" }: { value: Exaggeration | undefined; onChange: (s: Exaggeration) => void; lengthLabel?: string; widthLabel?: string }) {
  const s = value ?? NO_EXAGGERATION;
  return (
    <details className="exaggerate" open={isExaggerated(value)}>
      <summary>
        大きさの誇張{isExaggerated(value) && <span className="tag">誇張 ×{Math.round(s.all * Math.max(s.length, s.width) * 100) / 100}</span>}
      </summary>
      <Slider label="全体" unit="倍" value={s.all} min={0.5} max={3} step={0.05} onChange={(v) => onChange({ ...s, all: v })} />
      <div className="two">
        <Slider label={lengthLabel} unit="倍" value={s.length} min={0.5} max={3} step={0.05} onChange={(v) => onChange({ ...s, length: v })} />
        <Slider label={widthLabel} unit="倍" value={s.width} min={0.5} max={3} step={0.05} onChange={(v) => onChange({ ...s, width: v })} />
      </div>
      <div className="row" style={{ marginBottom: 0 }}>
        <small className="muted">この場面だけの大きさです。Euros の寸法は変えません。</small>
        {isExaggerated(value) && (
          <button className="small" onClick={() => onChange({ ...NO_EXAGGERATION })}>
            実際の大きさに戻す
          </button>
        )}
      </div>
    </details>
  );
}

/** 人ではない登場人物の色の印と名前 */
function WhoCreature({ c }: { c: SceneCreature }) {
  return (
    <>
      <span className="swatch round" style={{ background: hex(PERSON_COLORS[c.color % PERSON_COLORS.length].hex) }} />
      {c.name}
    </>
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
  // 人ではない登場人物も、いちばん上の高さを身長とみなして収める
  const all = [...scene.people, ...scene.creatures.map((cr) => ({ x: cr.x, z: cr.z, heightCm: creatureTop(cr) * 100 }))];
  const people = all.length ? all : [{ x: 0, z: 0, heightCm: 160 }];
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

type Tab = "people" | "creatures" | "props" | "contacts" | "camera";

/** 大きさ(m)を cm の入力にする */
const toCm = (m: number) => Math.round(m * 1000) / 10;

export function SceneEditor({ id, settings, onBack }: { id: string; settings: Settings; onBack: () => void }) {
  const [scene, setScene] = useState<Scene | null>(null);
  const [error, setError] = useState("");
  const [characters, setCharacters] = useState<Record<string, EurosCharacter>>({});
  const [eurosList, setEurosList] = useState<CharacterSummary[]>([]);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [selected, setSelected] = useState<number | null>(null);
  const [selectedCreature, setSelectedCreature] = useState<number | null>(null);
  const [equipment, setEquipment] = useState<Record<string, EurosEquipment>>({});
  const [estimating, setEstimating] = useState("");
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
        setSelectedCreature(s.creatures.length ? 0 : null);
        const ids = [...new Set([...s.people, ...s.creatures].map((p) => p.characterId))];
        const loaded = await Promise.all(ids.map((cid) => loadEurosCharacter(cid).catch(() => null)));
        setCharacters(Object.fromEntries(loaded.filter((c): c is EurosCharacter => !!c).map((c) => [c.id, c])));
      })
      .catch((e) => setError(message(e)));
    listEurosCharacters()
      .then(setEurosList)
      .catch(() => undefined);
    listEurosEquipment()
      .then((list) => setEquipment(Object.fromEntries(list.map((e) => [e.id, e]))))
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
  const selC = selectedCreature !== null ? scene.creatures[selectedCreature] : undefined;
  const setCreatureAt = (i: number, patch: Partial<SceneCreature>) => change((s) => ({ ...s, creatures: s.creatures.map((c, k) => (k === i ? { ...c, ...patch } : c)) }));
  const setCreature = (patch: Partial<SceneCreature>) => selectedCreature !== null && setCreatureAt(selectedCreature, patch);
  const setJoints = (patch: Partial<CreatureJoints>) => selC && setCreature({ joints: { ...selC.joints, ...patch } });
  const characterCount = scene.people.length + scene.creatures.length;
  const humans = eurosList.filter((c) => !c.notHuman);
  const nonHumans = eurosList.filter((c) => c.notHuman);

  const loadCharacter = async (characterId: string) => {
    const c = await loadEurosCharacter(characterId);
    setCharacters((m) => ({ ...m, [c.id]: c }));
    return c;
  };

  const addPerson = async (characterId: string) => {
    if (!characterId || characterCount >= MAX_CHARACTERS) return;
    try {
      const c = await loadCharacter(characterId);
      if (c.sheet?.notHuman) return addCreature(c);
      change((s) => {
        const p = personFrom(c, freeColor(usedColors(s), PERSON_COLORS.length));
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

  /** 人ではない登場人物を足す。人物の正面(1m ほど前)に、人物の方を向けて置く */
  const addCreature = (c: EurosCharacter) => {
    change((s) => ({ ...s, creatures: [...s.creatures, creatureFrom(c, freeColor(usedColors(s), PERSON_COLORS.length))] }));
    setSelectedCreature(scene.creatures.length);
    setTab("creatures");
  };

  const addCreatureById = async (characterId: string) => {
    if (!characterId || characterCount >= MAX_CHARACTERS) return;
    try {
      addCreature(await loadCharacter(characterId));
    } catch (e) {
      setError(message(e));
    }
  };

  const replaceCreature = async (characterId: string) => {
    if (selectedCreature === null || !characterId) return;
    try {
      const c = await loadCharacter(characterId);
      const next = creatureFrom(c, scene.creatures[selectedCreature].color);
      setCreature({ characterId: next.characterId, revisionId: next.revisionId, name: next.name, body: next.body, bodyFrom: next.bodyFrom });
    } catch (e) {
      setError(message(e));
    }
  };

  /** 説明から形の種類と大きさを推定する(Ollama) */
  const estimate = async () => {
    if (!selC) return;
    const c = characters[selC.characterId];
    if (!c) return;
    const index = selectedCreature!;
    setEstimating("推定しています…");
    try {
      const body = await estimateBody(settings, describe(c));
      setCreatureAt(index, { body, bodyFrom: "guess" });
      setEstimating("");
    } catch (e) {
      setEstimating(`推定できませんでした:${message(e)}`);
    }
  };

  const deleteCreature = () => {
    if (selectedCreature === null) return;
    change((s) => removeCreature(s, selectedCreature));
    setSelectedCreature(scene.creatures.length > 1 ? 0 : null);
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

  /** Euros の装備品を置く。寸法と型は Euros の値、色は小物の色 */
  const addEquipment = (id: string) => {
    const e = equipment[id];
    if (!e) return;
    const shape = equipmentShape(e);
    const long = PROP_KINDS[shape.kind].long;
    const name = equipmentName(e);
    const prop: SceneProp = {
      id: newId(),
      ...shape,
      grip: long ? 0.12 : 0.5,
      color: freeColor(scene.props.map((p) => p.color), PROP_COLORS.length),
      holder: long && selected !== null ? { person: selected, side: "r" } : null,
      x: 0.4,
      z: 0.3,
      yaw: 0,
      pitch: long ? 60 : 0,
      name: { ja: [name.ja, e.description?.ja].filter(Boolean).join("。"), en: [name.en, e.description?.en].filter(Boolean).join(", ") },
      equipment: { id: e.id, revisionId: equipmentImage(e)?.revisionId ?? null },
    };
    change((s) => ({ ...s, props: [...s.props, prop] }));
  };

  const addContact = () => {
    const me = selected ?? 0;
    // 選んでいる人物が長い物を持っていれば、その先から
    const held = scene.props.findIndex((p) => p.holder?.person === me && PROP_KINDS[p.kind].long);
    const from: ContactFrom = held >= 0 ? { kind: "prop", prop: held } : { kind: "hand", person: me, side: "r" };
    const other = scene.people.findIndex((_, i) => i !== me);
    // 相手はほかの人物、いなければ人ではない登場人物
    const to: ContactTo =
      other < 0 && scene.creatures.length ? { creature: 0, part: partsOf(scene.creatures[0].body)[0] } : { person: other >= 0 ? other : 0, part: "shoulder_l" };
    const contact: SceneContact = { id: newId(), from, to };
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
  const gazeKey = (g: Gaze | undefined) => (!g || g.kind === "manual" ? "manual" : g.kind === "camera" ? "camera" : g.kind === "creature" ? `c${g.index}` : `p${g.index}`);
  // 触れる点の「相手」の選択肢(人物と、人ではない登場人物)
  const toKey = (t: ContactTo) => (isCreatureTarget(t) ? `c${t.creature}` : `p${t.person}`);
  const partsFor = (t: ContactTo): { id: string; label: string }[] =>
    isCreatureTarget(t)
      ? scene.creatures[t.creature]
        ? partsOf(scene.creatures[t.creature].body).map((p) => ({ id: p, label: CREATURE_PARTS[p].label }))
        : []
      : (Object.keys(BODY_PARTS) as BodyPart[]).map((p) => ({ id: p, label: BODY_PARTS[p].label }));
  const setContactTo = (k: number, to: ContactTo) => change((s) => ({ ...s, contacts: s.contacts.map((x, i) => (i === k ? { ...x, to } : x)) }));

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
                ["creatures", `人ではない(${scene.creatures.length})`],
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
                {characterCount < MAX_CHARACTERS ? (
                  <label className="field" style={{ marginBottom: 0 }}>
                    <span>人物を足す(Euros のキャラクター。人ではない登場人物と合わせて最大{MAX_CHARACTERS}人)</span>
                    <select value="" onChange={(e) => void addPerson(e.target.value)}>
                      <option value="">(選ぶ)</option>
                      {humans.map((c) => (
                        <option key={c.id} value={c.id} disabled={!c.sheet}>
                          {c.name || "(名前なし)"}
                          {!c.sheet && "(シートなし)"}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <small className="muted">これ以上は足せません(人ではない登場人物と合わせて最大{MAX_CHARACTERS}人)。</small>
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
                        {humans.map((c) => (
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
                          setPerson({
                            gaze:
                              v === "manual"
                                ? { kind: "manual" }
                                : v === "camera"
                                  ? { kind: "camera" }
                                  : { kind: v[0] === "c" ? "creature" : "person", index: Number(v.slice(1)) },
                          });
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
                        {scene.creatures.map((c, i) => (
                          <option key={`c${i}`} value={`c${i}`}>
                            {c.name}を見る
                          </option>
                        ))}
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

          {tab === "creatures" && (
            <>
              <section className="card">
                <div className="chips">
                  {scene.creatures.map((c, i) => (
                    <button key={i} className={`chip${selectedCreature === i ? " active" : ""}`} onClick={() => setSelectedCreature(i)}>
                      <WhoCreature c={c} />
                    </button>
                  ))}
                </div>
                {characterCount < MAX_CHARACTERS ? (
                  <label className="field" style={{ marginBottom: 0 }}>
                    <span>人ではない登場人物を足す(Euros で「人ではない」にしたキャラクター)</span>
                    <select value="" onChange={(e) => void addCreatureById(e.target.value)}>
                      <option value="">(選ぶ)</option>
                      {nonHumans.map((c) => (
                        <option key={c.id} value={c.id} disabled={!c.sheet}>
                          {c.name || "(名前なし)"}
                          {!c.sheet && "(シートなし)"}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <small className="muted">これ以上は足せません(人物と合わせて最大{MAX_CHARACTERS}人)。</small>
                )}
                {!nonHumans.length && <small className="muted">Euros に人ではない登場人物がありません。</small>}
              </section>

              {selC && selectedCreature !== null && (
                <>
                  <section className="card">
                    <h3>
                      <WhoCreature c={selC} />
                      {isExaggerated(selC.scale) && <span className="tag">誇張</span>}
                    </h3>
                    <label className="field">
                      <span>Euros のキャラクター</span>
                      <select value={selC.characterId} onChange={(e) => void replaceCreature(e.target.value)}>
                        {nonHumans.map((c) => (
                          <option key={c.id} value={c.id} disabled={!c.sheet}>
                            {c.name || "(名前なし)"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>形の種類</span>
                      <select value={selC.body.form} onChange={(e) => setCreature({ body: changeForm(selC.body, e.target.value as CreatureForm) })}>
                        {(Object.keys(CREATURE_FORMS) as CreatureForm[]).map((f) => (
                          <option key={f} value={f}>
                            {CREATURE_FORMS[f].label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="two">
                      {Object.keys(CREATURE_FORMS[selC.body.form].size).map((k) => (
                        <label key={k} className="field">
                          <span>{sizeLabel(selC.body.form, k)}(cm)</span>
                          <input
                            type="number"
                            min={1}
                            value={toCm(selC.body.size[k] ?? 0)}
                            onChange={(e) => setCreature({ body: { ...selC.body, size: { ...selC.body.size, [k]: Math.max(1, Number(e.target.value) || 1) / 100 } } })}
                          />
                        </label>
                      ))}
                    </div>
                    {(selC.body.form === "quadruped" || selC.body.form === "biped") && (
                      <div className="row">
                        {selC.body.form === "biped" && (
                          <label className="check">
                            <input type="checkbox" checked={selC.body.arms !== false} onChange={(e) => setCreature({ body: { ...selC.body, arms: e.target.checked } })} />
                            腕
                          </label>
                        )}
                        <label className="check">
                          <input type="checkbox" checked={selC.body.tail !== false} onChange={(e) => setCreature({ body: { ...selC.body, tail: e.target.checked } })} />
                          尾
                        </label>
                      </div>
                    )}
                    <div className="row">
                      <small className="muted">
                        {selC.bodyFrom === "euros" ? "形と大きさは Euros の値です。" : "Euros に形と大きさがないので、説明から推定しました。直してください。"}
                      </small>
                      <button className="small" disabled={estimating.endsWith("…")} onClick={() => void estimate()}>
                        説明から推定(Ollama)
                      </button>
                      {estimating && <small className={estimating.endsWith("…") ? "muted" : "error"}>{estimating}</small>}
                    </div>
                    <div className="two">
                      <Slider label="左右の位置" unit="m" value={selC.x} min={-4} max={4} step={0.01} onChange={(v) => setCreature({ x: v })} />
                      <Slider label="前後の位置" unit="m" value={selC.z} min={-4} max={4} step={0.01} onChange={(v) => setCreature({ z: v })} />
                    </div>
                    <Slider label="向き" unit="°" value={selC.rotation} min={-180} max={180} step={5} onChange={(v) => setCreature({ rotation: v })} />
                    <small className="muted">3D の表示でドラッグしても動かせます。</small>
                  </section>

                  <section className="card">
                    <h3>形・ポーズ</h3>
                    {selC.body.form === "sphere" && (
                      <>
                        <Slider label="浮く高さ" unit="m" value={selC.lift} min={0} max={3} step={0.01} onChange={(v) => setCreature({ lift: v })} />
                        <div className="two">
                          <Slider label="前後の傾き" unit="°" value={selC.tilt} min={-90} max={90} step={5} onChange={(v) => setCreature({ tilt: v })} />
                          <Slider label="左右の傾き" unit="°" value={selC.roll} min={-90} max={90} step={5} onChange={(v) => setCreature({ roll: v })} />
                        </div>
                        <small className="muted">暗い丸が正面(目・レンズ)です。</small>
                      </>
                    )}
                    {selC.body.form === "blob" && (
                      <>
                        <Slider label="つぶれ(+)・伸び(-)" value={selC.squash} min={-0.5} max={0.6} step={0.05} onChange={(v) => setCreature({ squash: v })} />
                        <div className="two">
                          <label className="field">
                            <span>へこみ(叩かれた所など)</span>
                            <select
                              value={selC.dent?.part ?? ""}
                              onChange={(e) => setCreature({ dent: e.target.value ? { part: e.target.value as CreaturePart, depth: selC.dent?.depth ?? 0.25 } : null })}
                            >
                              <option value="">なし</option>
                              {partsOf(selC.body).map((p) => (
                                <option key={p} value={p}>
                                  {CREATURE_PARTS[p].label}
                                </option>
                              ))}
                            </select>
                          </label>
                          {selC.dent && <Slider label="へこみの深さ" value={selC.dent.depth} min={0} max={0.6} step={0.05} onChange={(v) => setCreature({ dent: { ...selC.dent!, depth: v } })} />}
                        </div>
                      </>
                    )}
                    {(selC.body.form === "quadruped" || selC.body.form === "biped") && (
                      <>
                        <div className="poses">
                          {STANCES.filter((st) => selC.body.form === "quadruped" || st.id !== "leap").map((st) => (
                            <button key={st.id} className={`small${selC.joints.stance === st.id ? " active" : ""}`} onClick={() => setJoints({ stance: st.id as Stance })}>
                              {st.label}
                            </button>
                          ))}
                        </div>
                        <div className="two">
                          <Slider label="首の左右" unit="°" value={selC.joints.neckYaw} min={-70} max={70} step={5} onChange={(v) => setJoints({ neckYaw: v })} />
                          <Slider label="首の上下(+で下)" unit="°" value={selC.joints.neckPitch} min={-45} max={60} step={5} onChange={(v) => setJoints({ neckPitch: v })} />
                        </div>
                        <div className="two">
                          <Slider label="体を前に倒す" unit="°" value={selC.joints.lean} min={-30} max={60} step={5} onChange={(v) => setJoints({ lean: v })} />
                          <Slider label="口を開く" value={selC.joints.mouth} min={0} max={1} step={0.05} onChange={(v) => setJoints({ mouth: v })} />
                        </div>
                        {selC.body.tail !== false && <Slider label="尾の上下" unit="°" value={selC.joints.tail} min={-40} max={90} step={5} onChange={(v) => setJoints({ tail: v })} />}
                        {selC.body.form === "biped" && selC.body.arms !== false && (
                          <div className="two">
                            <Slider label="右腕を上げる" unit="°" value={selC.joints.armR} min={-30} max={180} step={5} onChange={(v) => setJoints({ armR: v })} />
                            <Slider label="左腕を上げる" unit="°" value={selC.joints.armL} min={-30} max={180} step={5} onChange={(v) => setJoints({ armL: v })} />
                          </div>
                        )}
                      </>
                    )}
                    {selC.body.form === "object" && <small className="muted">物は置き方(位置と向き)だけを決めます。</small>}
                    <ScaleEditor value={selC.scale} lengthLabel="高さ・体長" widthLabel="太さ・幅" onChange={(v) => setCreature({ scale: v })} />
                    <label className="field">
                      <span>動作(日本語)</span>
                      <input value={selC.action.ja} placeholder="例:バットで叩かれて大きくへこむ" onChange={(e) => setCreature({ action: { ...selC.action, ja: e.target.value } })} />
                    </label>
                    <button className="small" onClick={deleteCreature}>
                      場面から外す
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
                {Object.keys(equipment).length > 0 && (
                  <label className="field" style={{ marginBottom: 0, marginTop: 8 }}>
                    <span>Euros の装備品を足す(寸法とデザインの画像は Euros の値)</span>
                    <select value="" onChange={(e) => addEquipment(e.target.value)}>
                      <option value="">(選ぶ)</option>
                      {Object.values(equipment).map((e) => (
                        <option key={e.id} value={e.id}>
                          {equipmentName(e).ja || equipmentName(e).en || "(名前なし)"}
                          {!equipmentImage(e) && "(画像なし)"}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </section>
              {scene.props.map((pr, k) => {
                const long = PROP_KINDS[pr.kind].long;
                const holderKey = pr.holder ? `${pr.holder.person}${pr.holder.side}` : "floor";
                // Euros の装備品の寸法は Euros の値のまま(大きさは誇張で変える)
                const fixed = !!pr.equipment;
                const eq = pr.equipment && equipment[pr.equipment.id];
                return (
                  <section key={pr.id} className="card">
                    <h3>
                      <span className="swatch" style={{ background: hex(PROP_COLORS[pr.color % PROP_COLORS.length].hex) }} />
                      {PROP_KINDS[pr.kind].label}
                      {pr.equipment && <span className="tag">Euros の装備品{eq ? `:${equipmentName(eq).ja || equipmentName(eq).en}` : "(見つかりません)"}</span>}
                      {isExaggerated(pr.scale) && <span className="tag">誇張</span>}
                    </h3>
                    <label className="field">
                      <span>見た目(日本語)</span>
                      <input value={pr.name.ja} placeholder="例:銀色の金属バット" onChange={(e) => setProp(k, { name: { ...pr.name, ja: e.target.value } })} />
                    </label>
                    <div className="two">
                      <label className="field">
                        <span>{long ? "長さ" : pr.kind === "ball" ? "直径" : "幅"}(cm)</span>
                        <input type="number" min={1} disabled={fixed} value={pr.lengthCm} onChange={(e) => setProp(k, { lengthCm: Math.max(1, Number(e.target.value) || 1) })} />
                      </label>
                      {pr.kind !== "ball" && (
                        <label className="field">
                          <span>{long ? "太さ" : "奥行き"}(cm)</span>
                          <input type="number" min={0.5} disabled={fixed} value={pr.widthCm} onChange={(e) => setProp(k, { widthCm: Math.max(0.5, Number(e.target.value) || 1) })} />
                        </label>
                      )}
                    </div>
                    {pr.kind === "box" && (
                      <label className="field">
                        <span>高さ(cm)</span>
                        <input type="number" min={1} disabled={fixed} value={pr.heightCm} onChange={(e) => setProp(k, { heightCm: Math.max(1, Number(e.target.value) || 1) })} />
                      </label>
                    )}
                    <ScaleEditor value={pr.scale} onChange={(v) => setProp(k, { scale: v })} />
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
                  手や小物の先を、相手の体に寄せます(人ではない登場人物にも)。触れる点の印は編集の画面にだけ出し、清書にはプロンプトで伝えます。
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
                      <select
                        value={toKey(c.to)}
                        onChange={(e) => {
                          const v = e.target.value;
                          const n = Number(v.slice(1));
                          if (v[0] === "c") {
                            // 部位は、前と同じものがなければ最初の部位(上・頭)にする
                            const parts = scene.creatures[n] ? partsOf(scene.creatures[n].body) : [];
                            const part = parts.includes(c.to.part as CreaturePart) ? (c.to.part as CreaturePart) : parts[0];
                            if (part) setContactTo(k, { creature: n, part });
                          } else {
                            setContactTo(k, { person: n, part: c.to.part in BODY_PARTS ? (c.to.part as BodyPart) : "chest" });
                          }
                        }}
                      >
                        {scene.people.map((p, i) => (
                          <option key={`p${i}`} value={`p${i}`}>
                            {p.name}
                          </option>
                        ))}
                        {scene.creatures.map((cr, i) => (
                          <option key={`c${i}`} value={`c${i}`}>
                            {cr.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>部位</span>
                      <select
                        value={c.to.part}
                        onChange={(e) =>
                          setContactTo(k, isCreatureTarget(c.to) ? { ...c.to, part: e.target.value as CreaturePart } : { ...c.to, part: e.target.value as BodyPart })
                        }
                      >
                        {partsFor(c.to).map((part) => (
                          <option key={part.id} value={part.id}>
                            {part.label}
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
            onSelectCreature={(i) => {
              setSelectedCreature(i);
              setTab("creatures");
            }}
            onMoveCreature={(i, x, z) => setCreatureAt(i, { x, z })}
            onLimb={(i, limb, pos) => change((s) => ({ ...s, people: s.people.map((p, k) => (k === i ? { ...p, ik: { ...p.ik, [limb]: pos } } : p)) }))}
          />
          <small className="muted">人物・人ではない登場人物をクリックで選び、ドラッグで動かす。白い背景・床・黒い点は清書では描かれません。</small>
        </div>
      </div>

      <RefinePanel scene={scene} characters={characters} equipment={equipment} settings={settings} viewport={viewport} change={change} flush={flush} />
    </div>
  );
}
