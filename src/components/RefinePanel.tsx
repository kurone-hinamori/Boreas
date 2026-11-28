import { type RefObject, useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import type { Settings } from "../types";
import { detectModels, progressText, refine, uploadImage } from "../lib/comfy";
import { unloadModel, translateFields } from "../lib/ollama";
import { useLeaveGuard } from "../lib/leaveGuard";
import { buildPrompt, type EurosCharacter, FRAMES, newId, type Reference, referencesOf, type Room, type Scene, sketchSize, type Take, type Text } from "../lib/scene";
import type { EurosEquipment } from "../lib/props";
import { deleteSceneFile, equipmentFileBytes, eurosFileBytes, exportSceneFile, placeFileBytes, saveSceneFile, sceneFileUrl } from "../lib/storage";
import type { ViewportHandle } from "./Viewport";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** 画像の拡張子(ComfyUI に送る名前に使う) */
const ext = (file: string) => file.split(".").pop()?.toLowerCase() || "png";

interface Props {
  scene: Scene;
  characters: Record<string, EurosCharacter>;
  equipment: Record<string, EurosEquipment>;
  /** 場面の場所と、いまのカメラから見える家具(場所がなければ null) */
  room: Room | null;
  settings: Settings;
  viewport: RefObject<ViewportHandle | null>;
  change: (fn: (s: Scene) => Scene, immediate?: boolean) => void;
  flush: () => Promise<void>;
}

/** 場面の画像を表示する */
function SceneImage({ sceneId, file, onClick }: { sceneId: string; file: string; onClick?: () => void }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let made: string | undefined;
    let alive = true;
    sceneFileUrl(sceneId, file)
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
  }, [sceneId, file]);
  return url ? <img src={url} alt="" onClick={onClick} /> : <div className="noimage">読み込み中…</div>;
}

/** Take に残す、渡した画像 */
const sheetOf = (r: Reference | null): Take["sheets"][number] => {
  switch (r!.kind) {
    case "character":
      return { characterId: r!.characterId, revisionId: r!.revisionId };
    case "equipment":
      return { equipmentId: r!.equipmentId, revisionId: r!.revisionId };
    case "place":
      return { placeId: r!.placeId, design: r!.image };
    case "furniture":
      return { placeId: r!.placeId, furnitureId: r!.furnitureId, design: r!.image };
  }
};

/** 清書:下絵を撮り、シートと一緒に ComfyUI(MiniMax-H3-Image)に渡して候補を作る */
export function RefinePanel({ scene, characters, equipment, room, settings, viewport, change, flush }: Props) {
  const [count, setCount] = useState(2);
  const [status, setStatus] = useState<{ running: boolean; text: string; error?: string }>({ running: false, text: "" });
  const [translating, setTranslating] = useState(false);
  const [viewing, setViewing] = useState<{ take: Take; file: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useLeaveGuard(status.running ? "清書の途中です。画面を離れると中断します。" : null);
  useEffect(() => () => abort.current?.abort(), []);

  // Picture 2 以降に渡す画像(人物のシート → 人ではない登場人物のシート → 装備品のデザイン)
  const refs = referencesOf(scene, characters, equipment, room);
  const sheets = refs.list;
  const cast = [...scene.people, ...scene.creatures];
  const noSheet = cast.filter((_, i) => !sheets[i]).map((p) => p.name);
  const prompt = buildPrompt(scene, characters, equipment, room);
  // 場所の説明が英語になっていなければ、場所の画面で英語にしてもらう
  const placeNoEn = !!room && [room.place.description, ...room.place.furniture.map((f) => f.name)].some((t) => t.ja.trim() && !t.en.trim());
  // 日本語だけで、英語になっていない項目
  const texts: [string, Text][] = [
    ...scene.people.flatMap((p, i): [string, Text][] => [
      [`p${i}_action`, p.action],
      [`p${i}_expression`, p.expression],
    ]),
    ...scene.creatures.map((c, i): [string, Text] => [`c${i}_action`, c.action]),
    ...scene.props.map((pr, k): [string, Text] => [`prop${k}`, pr.name]),
    ["background", scene.background],
  ];
  const missingEn = texts.some(([, t]) => t.ja.trim() && !t.en.trim());

  const translate = async () => {
    setTranslating(true);
    setStatus({ running: false, text: "" });
    try {
      const en = await translateFields(settings, Object.fromEntries(texts.map(([k, t]) => [k, t.ja])));
      const pick = (k: string, t: Text): Text => ({ ...t, en: t.ja.trim() ? (en[k] ?? t.en) : "" });
      change((s) => ({
        ...s,
        background: pick("background", s.background),
        people: s.people.map((p, i) => ({ ...p, action: pick(`p${i}_action`, p.action), expression: pick(`p${i}_expression`, p.expression) })),
        creatures: s.creatures.map((c, i) => ({ ...c, action: pick(`c${i}_action`, c.action) })),
        props: s.props.map((pr, k) => ({ ...pr, name: pick(`prop${k}`, pr.name) })),
      }));
    } catch (e) {
      setStatus({ running: false, text: "", error: `英語にできませんでした:${message(e)}` });
    } finally {
      setTranslating(false);
    }
  };

  const run = async () => {
    if (!cast.length || noSheet.length || !viewport.current) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const say = (text: string) => !ctrl.signal.aborted && setStatus({ running: true, text });
    try {
      await flush();
      // 下絵を撮る(同じ清書の候補は、すべて同じ下絵から作る)
      say("下絵を撮っています");
      const [sw, sh] = sketchSize(scene.frame);
      const sketchPng = await viewport.current.capture(sw, sh);
      const sketchId = newId();
      const sketch = `sketches/${sketchId}.png`;
      await saveSceneFile(scene.id, sketch, sketchPng);

      // 見える家具は、撮る枠の縦横比で数え直す(プロンプトと渡すデザインも、それに合わせる)
      const shot: Room | null = room ? { place: room.place, visible: viewport.current.visibleFurniture(sw / sh) } : null;
      const shotRefs = referencesOf(scene, characters, equipment, shot).list;
      const shotPrompt = buildPrompt(scene, characters, equipment, shot);

      say("ComfyUI のモデルを確かめています");
      const models = await detectModels(settings);
      say("Ollama のモデルを GPU から外しています");
      await unloadModel(settings);
      say("下絵とシートを ComfyUI に送っています");
      const images = [await uploadImage(settings, `sketch_${scene.id}_${sketchId}.png`, sketchPng)];
      for (const r of shotRefs) {
        if (r?.kind === "place" || r?.kind === "furniture") images.push(await uploadImage(settings, `place_${r.placeId}_${r.image.split("/").pop()}`, await placeFileBytes(r.placeId, r.image)));
        if (r?.kind === "character") images.push(await uploadImage(settings, `sheet_${r.characterId}_${r.revisionId}.${ext(r.image)}`, await eurosFileBytes(r.characterId, r.image)));
        if (r?.kind === "equipment") images.push(await uploadImage(settings, `equipment_${r.equipmentId}_${r.revisionId ?? "x"}.${ext(r.image)}`, await equipmentFileBytes(r.equipmentId, r.image)));
      }

      const { width, height } = FRAMES[scene.frame];
      for (let i = 0; i < count; i++) {
        const takeId = newId();
        const seed = Math.floor(Math.random() * 2 ** 32);
        const base: Take = {
          id: takeId,
          createdAt: new Date().toISOString(),
          frame: scene.frame,
          sketch,
          result: null,
          seed,
          prompt: shotPrompt,
          sheets: shotRefs.map(sheetOf),
        };
        const label = count > 1 ? `${i + 1}/${count}枚目:` : "";
        try {
          const r = await refine(settings, models, { prompt: shotPrompt, width, height, seed, images }, ctrl.signal, (p) => say(label + progressText(p)));
          const result = `results/${takeId}.png`;
          await saveSceneFile(scene.id, result, r.png);
          change((s) => ({ ...s, takes: [...s.takes, { ...base, result, workflow: r.workflow }], adopted: s.adopted ?? takeId }), true);
        } catch (e) {
          if (ctrl.signal.aborted) throw e;
          change((s) => ({ ...s, takes: [...s.takes, { ...base, error: message(e) }] }), true);
          throw e;
        }
      }
      setStatus({ running: false, text: "清書が終わりました" });
    } catch (e) {
      setStatus(ctrl.signal.aborted ? { running: false, text: "中断しました" } : { running: false, text: "", error: message(e) });
    } finally {
      if (abort.current === ctrl) abort.current = null;
    }
  };

  const exportTake = async (t: Take) => {
    if (!t.result) return;
    const path = await save({ title: "清書を書き出す", defaultPath: `${scene.title || "boreas"}.png`, filters: [{ name: "PNG", extensions: ["png"] }] });
    if (path) await exportSceneFile(scene.id, t.result, path).catch((e) => setStatus({ running: false, text: "", error: message(e) }));
  };

  const removeTake = async (t: Take) => {
    change((s) => ({ ...s, takes: s.takes.filter((x) => x.id !== t.id), adopted: s.adopted === t.id ? null : s.adopted }), true);
    if (t.result) await deleteSceneFile(scene.id, t.result).catch(() => undefined);
    // 下絵は、ほかの候補が使っていなければ消す
    if (!scene.takes.some((x) => x.id !== t.id && x.sketch === t.sketch)) await deleteSceneFile(scene.id, t.sketch).catch(() => undefined);
  };

  const takes = [...scene.takes].reverse();

  return (
    <section className="card refine">
      <h3>清書</h3>
      <div className="refine-grid">
        <div>
          <label className="field">
            <span>{room ? "背景に足すこと(日本語。時間帯・窓の外など。部屋は場所の説明を使います)" : "背景(日本語)"}</span>
            <textarea rows={2} value={scene.background.ja} placeholder={room ? "例:夜。窓の外は雨" : "例:夕暮れの学校の屋上。金網のフェンス"} onChange={(e) => change((s) => ({ ...s, background: { ...s.background, ja: e.target.value } }))} />
          </label>
          <div className="en-fields">
            <div className="row" style={{ marginBottom: 6 }}>
              <button className="small" disabled={translating || status.running} onClick={() => void translate()}>
                {translating ? "英語にしています…" : "英語にする(Ollama)"}
              </button>
              {missingEn && <small className="error">英語になっていない項目があります</small>}
              {placeNoEn && <small className="error">場所の説明が英語になっていません(場所の画面で英語にしてください)</small>}
            </div>
            {scene.people.map((p, i) => (
              <div key={i} className="two">
                <label className="field">
                  <span>{p.name}の動作(英語)</span>
                  <input className="en" value={p.action.en} onChange={(e) => change((s) => ({ ...s, people: s.people.map((x, k) => (k === i ? { ...x, action: { ...x.action, en: e.target.value } } : x)) }))} />
                </label>
                <label className="field">
                  <span>{p.name}の表情(英語)</span>
                  <input className="en" value={p.expression.en} onChange={(e) => change((s) => ({ ...s, people: s.people.map((x, k) => (k === i ? { ...x, expression: { ...x.expression, en: e.target.value } } : x)) }))} />
                </label>
              </div>
            ))}
            {scene.creatures.map((c, i) => (
              <label key={`c${i}`} className="field">
                <span>{c.name}の動作(英語)</span>
                <input className="en" value={c.action.en} onChange={(e) => change((s) => ({ ...s, creatures: s.creatures.map((x, k) => (k === i ? { ...x, action: { ...x.action, en: e.target.value } } : x)) }))} />
              </label>
            ))}
            {scene.props.map((pr, k) => (
              <label key={pr.id} className="field">
                <span>{pr.name.ja || "小物"}(英語)</span>
                <input className="en" value={pr.name.en} onChange={(e) => change((s) => ({ ...s, props: s.props.map((x, i) => (i === k ? { ...x, name: { ...x.name, en: e.target.value } } : x)) }))} />
              </label>
            ))}
            <label className="field">
              <span>背景(英語)</span>
              <input className="en" value={scene.background.en} onChange={(e) => change((s) => ({ ...s, background: { ...s.background, en: e.target.value } }))} />
            </label>
          </div>
          <details className="prompt">
            <summary>清書に使うプロンプト</summary>
            <pre>{prompt}</pre>
          </details>
        </div>
        <div>
          <div className="row">
            <label className="check">
              候補
              <select value={count} style={{ width: "auto" }} onChange={(e) => setCount(Number(e.target.value))}>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}枚
                  </option>
                ))}
              </select>
            </label>
            {status.running ? (
              <button onClick={() => abort.current?.abort()}>中断</button>
            ) : (
              <button className="primary" disabled={!cast.length || noSheet.length > 0} onClick={() => void run()}>
                清書する
              </button>
            )}
          </div>
          {!cast.length && <p className="muted small-text">人物を置くと清書できます。</p>}
          {noSheet.length > 0 && <p className="error small-text">{noSheet.join("・")}には Euros のシートがありません。</p>}
          <p className="muted small-text">1枚に6分ほどかかります。ComfyUI に MiniMax-H3-Image のモデルが必要です。</p>
          {status.running && <p className="status">{status.text}</p>}
          {!status.running && status.text && <p className="muted">{status.text}</p>}
          {status.error && <p className="error">{status.error}</p>}
        </div>
      </div>

      {takes.length > 0 && (
        <div className="takes">
          {takes.map((t) => (
            <figure key={t.id} className={`take${scene.adopted === t.id ? " adopted" : ""}`}>
              <div className="take-image">
                <SceneImage sceneId={scene.id} file={t.result ?? t.sketch} onClick={() => setViewing({ take: t, file: t.result ?? t.sketch })} />
              </div>
              <figcaption>
                <div className="small-text muted">
                  {new Date(t.createdAt).toLocaleString()} · seed {t.seed}
                  {scene.adopted === t.id && <span className="tag">採用</span>}
                </div>
                {t.error && <div className="error small-text">{t.error}</div>}
                <div className="row" style={{ marginBottom: 0 }}>
                  {t.result && scene.adopted !== t.id && (
                    <button className="small" onClick={() => change((s) => ({ ...s, adopted: t.id }), true)}>
                      採用
                    </button>
                  )}
                  <button className="small" onClick={() => setViewing({ take: t, file: t.sketch })}>
                    下絵
                  </button>
                  {t.result && (
                    <button className="small" onClick={() => void exportTake(t)}>
                      書き出す
                    </button>
                  )}
                  <button className="small" disabled={status.running} onClick={() => void removeTake(t)}>
                    削除
                  </button>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {viewing && (
        <div className="lightbox" onClick={() => setViewing(null)}>
          <SceneImage sceneId={scene.id} file={viewing.file} />
          <div className="lightbox-bar">
            {viewing.file === viewing.take.sketch ? "下絵" : "清書"} · クリックで閉じる
          </div>
        </div>
      )}
    </section>
  );
}
