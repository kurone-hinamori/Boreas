import { listPlaces } from "../lib/storage";
import { EntryList } from "./EntryList";

/** 部屋や家具をまとめた場所の一覧 */
export function PlaceList() {
  return <EntryList title="場所" load={listPlaces} empty="まだ場所がありません。" note="間取り図と家具の配置は、これから作ります。" />;
}
