import { invoke } from "@tauri-apps/api/core";
import type { CharacterSummary, Entry, Folders, Settings } from "../types";
import { DEFAULT_SETTINGS } from "../types";

/** アプリのデータフォルダーの settings.json から読む */
export async function loadSettings(): Promise<Settings> {
  try {
    const s = await invoke<Partial<Settings> | null>("load_settings");
    return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
export const saveSettings = (settings: Settings) => invoke<void>("save_settings", { settings });

export const folders = () => invoke<Folders>("folders");
export const openFolder = (which: keyof Folders) => invoke<void>("open_folder", { which });

export const listScenes = () => invoke<Entry[]>("list_scenes");
export const listPlaces = () => invoke<Entry[]>("list_places");

/** Euros のキャラクター(読むだけ) */
export const listEurosCharacters = () => invoke<CharacterSummary[]>("list_euros_characters");

/** Euros のキャラクターの画像を <img> で見せる URL にする(使い終わったら URL.revokeObjectURL) */
export async function eurosFileUrl(id: string, file: string): Promise<string> {
  const bytes = await invoke<ArrayBuffer>("load_euros_file", { id, file });
  const ext = file.split(".").pop()?.toLowerCase();
  const type = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
  return URL.createObjectURL(new Blob([bytes], { type }));
}
