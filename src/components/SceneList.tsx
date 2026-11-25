import { useEffect, useState } from "react";
import { newScene, type Scene, thumbnailOf } from "../lib/scene";
import { listSceneData, saveScene, sceneFileUrl } from "../lib/storage";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Thumb({ scene }: { scene: Scene }) {
  const file = thumbnailOf(scene);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!file) return;
    let made: string | undefined;
    let alive = true;
    sceneFileUrl(scene.id, file)
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
  }, [scene.id, file]);
  return <div className="thumb portrait">{url ? <img src={url} alt="" /> : "まだ清書していません"}</div>;
}

/** 表紙や挿絵にする場面の一覧 */
export function SceneList({ onOpen }: { onOpen: (id: string) => void }) {
  const [list, setList] = useState<Scene[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    listSceneData()
      .then(setList)
      .catch((e) => setError(message(e)));
  }, []);

  const create = async () => {
    const s = newScene("無題の場面");
    try {
      await saveScene(s);
      onOpen(s.id);
    } catch (e) {
      setError(message(e));
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <h2>場面</h2>
        <div className="grow" />
        <button className="primary" onClick={() => void create()}>
          新規作成
        </button>
      </header>
      {error && <p className="error">読み込めませんでした:{error}</p>}
      {list && list.length === 0 && (
        <div className="empty">
          <div>まだ場面がありません。</div>
          <small className="muted">Euros のキャラクターを 3D の素体で動かして下絵を作り、ComfyUI で表紙や挿絵に清書します。</small>
          <div>
            <button className="primary" onClick={() => void create()}>
              新規作成
            </button>
          </div>
        </div>
      )}
      {list && list.length > 0 && (
        <div className="grid">
          {list.map((s) => (
            <button key={s.id} className="tile" onClick={() => onOpen(s.id)}>
              <Thumb scene={s} />
              <div className="meta">
                <div className="name">{s.title || "無題の場面"}</div>
                <div className="sub">
                  {s.people.map((p) => p.name).join("・") || "人物なし"} · {s.updatedAt.slice(0, 10)}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
