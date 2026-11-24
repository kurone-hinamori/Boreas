import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import type { Folder, Folders, Settings } from "../types";
import { comfyStats, ollamaModels } from "../lib/connect";
import { folders as loadFolders, openFolder, saveSettings } from "../lib/storage";
import { installUpdate } from "../lib/updater";

type Status = { ok: boolean; text: string } | null;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Field(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input value={props.value} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}

/** 設定のキーと、画面に出す名前 */
const FOLDERS: { which: keyof Folders; key: "libraryDir" | "eurosLibraryDir" | "notosDataDir"; title: string; note: string }[] = [
  { which: "library", key: "libraryDir", title: "Boreas の保存先", note: "場所と場面、下絵と清書の画像を保存します。" },
  { which: "euros", key: "eurosLibraryDir", title: "Euros のライブラリ", note: "キャラクターと装備品を読み込みます(書き換えません)。" },
  { which: "notos", key: "notosDataDir", title: "Notos のデータ", note: "作品と場面を読み込みます(書き換えません)。" },
];

export function SettingsView({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const [comfy, setComfy] = useState<Status>(null);
  const [ollama, setOllama] = useState<Status>(null);
  const [models, setModels] = useState<string[]>([]);
  const [dirs, setDirs] = useState<Folders>();
  const [version, setVersion] = useState("");
  const [updateMsg, setUpdateMsg] = useState("");
  const [updating, setUpdating] = useState(false);

  const checkComfy = async () => {
    setComfy({ ok: true, text: "確認中…" });
    try {
      const st = await comfyStats(settings.comfyUrl);
      setComfy({ ok: true, text: `接続できました(ComfyUI ${st.version}${st.gpu ? ` · ${st.gpu}` : ""})` });
    } catch (e) {
      setComfy({ ok: false, text: `接続できません。ComfyUI が起動しているか確認してください。(${message(e)})` });
    }
  };

  const checkOllama = async () => {
    setOllama({ ok: true, text: "確認中…" });
    try {
      const list = await ollamaModels(settings.ollamaUrl);
      setModels(list);
      setOllama({ ok: true, text: `接続できました(モデル ${list.length} 件)` });
      if (!settings.model && list.length) onChange({ ...settings, model: list[0] });
    } catch (e) {
      setModels([]);
      setOllama({ ok: false, text: `接続できません。Ollama が起動しているか確認してください。(${message(e)})` });
    }
  };

  const refreshFolders = () => loadFolders().then(setDirs).catch(() => undefined);

  useEffect(() => {
    void checkComfy();
    void checkOllama();
    void refreshFolders();
    getVersion().then(setVersion).catch(() => undefined);
    // 開いたときに一度だけ確認する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 場所は Rust が settings.json から読むので、先に保存してから切り替える */
  const changeFolder = async (key: (typeof FOLDERS)[number]["key"], dir: string) => {
    const next = { ...settings, [key]: dir };
    await saveSettings(next);
    onChange(next);
    await refreshFolders();
  };

  const chooseFolder = async (f: (typeof FOLDERS)[number]) => {
    const dir = await open({ directory: true, title: `${f.title}を選ぶ` });
    if (typeof dir === "string") await changeFolder(f.key, dir);
  };

  const checkUpdate = async () => {
    setUpdating(true);
    setUpdateMsg("確認中…");
    try {
      const u = await check();
      if (!u) {
        setUpdateMsg("最新版です");
        return;
      }
      setUpdateMsg(`新しいバージョン ${u.version} をダウンロード中… 0%`);
      await installUpdate(u, (p) => setUpdateMsg(`新しいバージョン ${u.version} をダウンロード中… ${p}%`));
      setUpdateMsg("更新しました。再起動します…");
    } catch (e) {
      setUpdateMsg(`更新できませんでした:${message(e)}`);
    } finally {
      setUpdating(false);
    }
  };

  const statusLine = (s: Status) => s && <span className={s.ok ? "muted" : "error"}>{s.text}</span>;

  const folderCard = (f: (typeof FOLDERS)[number], d: Folder | undefined) => (
    <div key={f.which} className="field">
      <span>
        {f.title}
        {!settings[f.key] && "(既定)"}:{f.note}
      </span>
      <div className="mono">
        {d?.path ?? "…"}
        {d && !d.exists && <span className="error">(見つかりません)</span>}
      </div>
      <div className="row" style={{ marginTop: 4 }}>
        <button className="small" onClick={() => void chooseFolder(f)}>
          場所を選ぶ
        </button>
        {settings[f.key] && (
          <button className="small" onClick={() => void changeFolder(f.key, "")}>
            既定に戻す
          </button>
        )}
        <button className="small" disabled={!d?.exists} onClick={() => void openFolder(f.which).catch(() => undefined)}>
          フォルダーを開く
        </button>
      </div>
    </div>
  );

  return (
    <div className="page narrow">
      <header className="page-head">
        <h2>設定</h2>
      </header>

      <section className="card">
        <h3>清書(ComfyUI)</h3>
        <Field label="ComfyUI の URL" value={settings.comfyUrl} onChange={(v) => onChange({ ...settings, comfyUrl: v })} />
        <div className="row">
          <button onClick={() => void checkComfy()}>接続確認</button>
          {statusLine(comfy)}
        </div>
      </section>

      <section className="card">
        <h3>プロンプトの作成(Ollama)</h3>
        <Field label="Ollama の URL" value={settings.ollamaUrl} onChange={(v) => onChange({ ...settings, ollamaUrl: v })} />
        <div className="row">
          <button onClick={() => void checkOllama()}>接続確認・モデル一覧を更新</button>
          {statusLine(ollama)}
        </div>
        <label className="field">
          <span>使用するモデル</span>
          <select value={settings.model} onChange={(e) => onChange({ ...settings, model: e.target.value })}>
            {!models.includes(settings.model) && <option value={settings.model}>{settings.model || "(未選択)"}</option>}
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="card">
        <h3>フォルダー</h3>
        {FOLDERS.map((f) => folderCard(f, dirs?.[f.which]))}
      </section>

      <section className="card">
        <h3>バージョン</h3>
        <div className="row" style={{ marginBottom: 0 }}>
          <span>Boreas {version && `v${version}`}</span>
          <button disabled={updating} onClick={() => void checkUpdate()}>
            更新を確認
          </button>
          {updateMsg && <span className="muted">{updateMsg}</span>}
        </div>
      </section>
    </div>
  );
}
