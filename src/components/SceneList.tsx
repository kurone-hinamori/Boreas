import { listScenes } from "../lib/storage";
import { EntryList } from "./EntryList";

/** 表紙や挿絵にする場面の一覧 */
export function SceneList() {
  return <EntryList title="場面" load={listScenes} empty="まだ場面がありません。" note="場面の編集(3D の下絵と清書)は、これから作ります。" />;
}
