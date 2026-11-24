import { useEffect, useState } from "react";
import type { CharacterSummary } from "../types";
import { eurosFileUrl, listEurosCharacters } from "../lib/storage";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Sheet({ id, file }: { id: string; file: string | null }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!file) return;
    let made: string | undefined;
    let alive = true;
    eurosFileUrl(id, file)
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
  }, [id, file]);
  return <div className="thumb">{url ? <img className="sheet" src={url} alt="" /> : "シートなし"}</div>;
}

/** Euros で作ったキャラクター。Boreas からは読むだけで、作成と編集は Euros で行う */
export function CharacterList({ onSettings }: { onSettings: () => void }) {
  const [list, setList] = useState<CharacterSummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    listEurosCharacters()
      .then(setList)
      .catch((e) => setError(message(e)));
  }, []);

  return (
    <div className="page">
      <header className="page-head">
        <h2>キャラクター</h2>
        <span className="muted">Euros のライブラリから読み込みます。作成と編集は Euros で行います。</span>
      </header>
      {error && <p className="error">読み込めませんでした:{error}</p>}
      {list && list.length === 0 && (
        <div className="empty">
          <div>Euros のキャラクターが見つかりません。</div>
          <small className="muted">Euros でキャラクターを作るか、設定で Euros のライブラリの場所を確かめてください。</small>
          <div>
            <button onClick={onSettings}>設定を開く</button>
          </div>
        </div>
      )}
      {list && list.length > 0 && (
        <div className="grid">
          {list.map((c) => (
            <div key={c.id} className="tile static">
              <Sheet id={c.id} file={c.sheet} />
              <div className="meta">
                <div className="name">{c.name || "(名前なし)"}</div>
                <div className="sub">{c.reading}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
