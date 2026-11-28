import { useEffect, useState } from "react";
import { newPlace, type Place } from "../lib/place";
import { listPlaceData, savePlace } from "../lib/storage";
import { PlaceImage } from "./PlaceEditor";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 場所(部屋・家具)の一覧。一覧の絵は部屋のデザイン */
export function PlaceList({ onOpen }: { onOpen: (id: string) => void }) {
  const [list, setList] = useState<Place[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    listPlaceData()
      .then(setList)
      .catch((e) => setError(message(e)));
  }, []);

  const create = async () => {
    const p = newPlace("無題の場所");
    try {
      await savePlace(p);
      onOpen(p.id);
    } catch (e) {
      setError(message(e));
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <h2>場所</h2>
        <div className="grow" />
        <button className="primary" onClick={() => void create()}>
          新規作成
        </button>
      </header>
      {error && <p className="error">読み込めませんでした:{error}</p>}
      {list && list.length === 0 && (
        <div className="empty">
          <div>まだ場所がありません。</div>
          <small className="muted">部屋を間取り図と寸法で作り、家具を置きます。同じ部屋の別の場面で、見える物が食い違わないようにします。</small>
          <div>
            <button className="primary" onClick={() => void create()}>
              新規作成
            </button>
          </div>
        </div>
      )}
      {list && list.length > 0 && (
        <div className="grid">
          {list.map((p) => (
            <button key={p.id} className="tile" onClick={() => onOpen(p.id)}>
              <div className="thumb">{p.design ? <PlaceImage placeId={p.id} file={p.design.file} /> : "デザインなし"}</div>
              <div className="meta">
                <div className="name">{p.title || "無題の場所"}</div>
                <div className="sub">
                  家具 {p.furniture?.length ?? 0} · {p.updatedAt?.slice(0, 10)}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
