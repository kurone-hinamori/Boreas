import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { Settings } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { loadSettings, saveSettings } from "./lib/storage";
import { SceneList } from "./components/SceneList";
import { PlaceList } from "./components/PlaceList";
import { CharacterList } from "./components/CharacterList";
import { SettingsView } from "./components/SettingsView";
import { UpdateBanner } from "./components/UpdateBanner";
import { ErrorBoundary } from "./components/ErrorBoundary";

export type View = { kind: "scenes" } | { kind: "places" } | { kind: "characters" } | { kind: "settings" };

export default function App() {
  const [view, setView] = useState<View>({ kind: "scenes" });
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState("");

  useEffect(() => {
    void loadSettings().then((s) => {
      setSettings(s);
      setReady(true);
    });
    getVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  const changeSettings = (s: Settings) => {
    setSettings(s);
    void saveSettings(s).catch(() => undefined);
  };

  const nav = (label: string, target: View) => (
    <button className={`nav${view.kind === target.kind ? " active" : ""}`} onClick={() => setView(target)}>
      {label}
    </button>
  );

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">BOREAS</div>
        {nav("場面", { kind: "scenes" })}
        {nav("場所", { kind: "places" })}
        {nav("キャラクター", { kind: "characters" })}
        <div className="spacer" />
        {nav("設定", { kind: "settings" })}
        {version && <div className="version">v{version}</div>}
      </aside>
      <main className="main">
        <UpdateBanner />
        <div className="content">
          <ErrorBoundary key={view.kind} onBack={() => setView({ kind: "scenes" })}>
            {!ready ? null : view.kind === "scenes" ? (
              <SceneList />
            ) : view.kind === "places" ? (
              <PlaceList />
            ) : view.kind === "characters" ? (
              <CharacterList onSettings={() => setView({ kind: "settings" })} />
            ) : (
              <SettingsView settings={settings} onChange={changeSettings} />
            )}
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
