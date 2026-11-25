import { type RefObject, useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import type { Settings } from "../types";
import { detectModels, progressText, refine, uploadImage } from "../lib/comfy";
import { unloadModel, translateFields } from "../lib/ollama";
import { useLeaveGuard } from "../lib/leaveGuard";
import { buildPrompt, currentSheet, type EurosCharacter, FRAMES, newId, type Scene, sketchSize, type Take } from "../lib/scene";
import { deleteSceneFile, eurosFileBytes, exportSceneFile, saveSceneFile, sceneFileUrl } from "../lib/storage";
import type { ViewportHandle } from "./Viewport";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Props {
  scene: Scene;
  characters: Record<string, EurosCharacter>;
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

/** 清書:下絵を撮り、シートと一緒に ComfyUI(MiniMax-H3-Image)に渡して候補を作る */
export function RefinePanel({ scene, characters, settings, viewport, change, flush }: Props) {
  const [count, setCount] = useState(2);
  const [status, setStatus] = useState<{ running: boolean; text: string; error?: string }>({ running: false, text: "" });
  const [translating, setTranslating] = useState(false);
  const [viewing, setViewing] = useState<{ take: Take; file: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useLeaveGuard(status.running ? "清書の途中です。画面を離れると中断します。" : null);
  useEffect(() => () => abort.current?.abort(), []);

  const person = scene.people[0];
  const character = person ? characters[person.characterId] : undefined;
  const sheet = character ? currentSheet(character) : null;
  const prompt = buildPrompt(scene, characters);
  const missingEn = !!person && ((!!person.action.ja.trim() && !person.action.en.trim()) || (!!person.expression.ja.trim() && !person.expression.en.trim()) || (!!scene.background.ja.trim() && !scene.background.en.trim()));

  const translate = async () => {
    if (!person) return;
    setTranslating(true);
    setStatus({ running: false, text: "" });
    try {
      const en = await translateFields(settings, { action: person.action.ja, expression: person.expression.ja, background: scene.background.ja });
      change((s) => ({
        ...s,
        background: { ...s.background, en: en.background },
        people: s.people.map((p, i) => (i === 0 ? { ...p, action: { ...p.action, en: en.action }, expression: { ...p.expression, en: en.expression } } : p)),
      }));
    } catch (e) {
      setStatus({ running: false, text: "", error: `英語にできませんでした:${message(e)}` });
    } finally {
      setTranslating(false);
    }
  };

  const run = async () => {
    if (!person || !character || !sheet || !viewport.current) return;
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

      say("ComfyUI のモデルを確かめています");
      const models = await detectModels(settings);
      say("Ollama のモデルを GPU から外しています");
      await unloadModel(settings);
      say("下絵とシートを ComfyUI に送っています");
      const images = [await uploadImage(settings, `sketch_${scene.id}_${sketchId}.png`, sketchPng)];
      images.push(await uploadImage(settings, `sheet_${character.id}_${sheet.revisionId}.png`, await eurosFileBytes(character.id, sheet.image)));

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
          prompt,
          sheets: [{ characterId: character.id, revisionId: sheet.revisionId }],
        };
        const label = count > 1 ? `${i + 1}/${count}枚目:` : "";
        try {
          const r = await refine(settings, models, { prompt, width, height, seed, images }, ctrl.signal, (p) => say(label + progressText(p)));
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
            <span>背景(日本語)</span>
            <textarea rows={2} value={scene.background.ja} placeholder="例:夕暮れの学校の屋上。金網のフェンス" onChange={(e) => change((s) => ({ ...s, background: { ...s.background, ja: e.target.value } }))} />
          </label>
          {person && (
            <div className="en-fields">
              <div className="row" style={{ marginBottom: 6 }}>
                <button className="small" disabled={translating || status.running} onClick={() => void translate()}>
                  {translating ? "英語にしています…" : "英語にする(Ollama)"}
                </button>
                {missingEn && <small className="error">英語になっていない項目があります</small>}
              </div>
              <label className="field">
                <span>動作(英語)</span>
                <input className="en" value={person.action.en} onChange={(e) => change((s) => ({ ...s, people: s.people.map((p, i) => (i === 0 ? { ...p, action: { ...p.action, en: e.target.value } } : p)) }))} />
              </label>
              <label className="field">
                <span>表情(英語)</span>
                <input className="en" value={person.expression.en} onChange={(e) => change((s) => ({ ...s, people: s.people.map((p, i) => (i === 0 ? { ...p, expression: { ...p.expression, en: e.target.value } } : p)) }))} />
              </label>
              <label className="field">
                <span>背景(英語)</span>
                <input className="en" value={scene.background.en} onChange={(e) => change((s) => ({ ...s, background: { ...s.background, en: e.target.value } }))} />
              </label>
            </div>
          )}
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
              <button className="primary" disabled={!person || !sheet} onClick={() => void run()}>
                清書する
              </button>
            )}
          </div>
          {!person && <p className="muted small-text">人物を選ぶと清書できます。</p>}
          {person && !sheet && <p className="error small-text">このキャラクターには Euros のシートがありません。</p>}
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
