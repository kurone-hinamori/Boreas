import { useEffect, useState } from "react";
import type { Entry } from "../types";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 場面と場所の一覧。中身の編集はこれから作る */
export function EntryList(props: { title: string; load: () => Promise<Entry[]>; empty: string; note: string }) {
  const [list, setList] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    props
      .load()
      .then(setList)
      .catch((e) => setError(message(e)));
    // 開いたときに一度だけ読む
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="page">
      <header className="page-head">
        <h2>{props.title}</h2>
        <div className="grow" />
        <button className="primary" disabled title="これから作ります">
          新規作成
        </button>
      </header>
      {error && <p className="error">読み込めませんでした:{error}</p>}
      {list && list.length === 0 && (
        <div className="empty">
          <div>{props.empty}</div>
          <small className="muted">{props.note}</small>
        </div>
      )}
      {list && list.length > 0 && (
        <div className="grid">
          {list.map((e) => (
            <div key={e.id} className="tile static">
              <div className="thumb">下絵なし</div>
              <div className="meta">
                <div className="name">{e.title || "(無題)"}</div>
                <div className="sub">{e.updatedAt?.slice(0, 10)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
