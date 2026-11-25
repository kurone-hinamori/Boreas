import { invoke } from "@tauri-apps/api/core";
import type { CharacterSummary, Entry, Folders, Settings } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import type { EurosCharacter, Scene } from "./scene";

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

// ---------------------------------------------------------------- 場面

export const loadEurosCharacter = (id: string) => invoke<EurosCharacter>("load_euros_character", { id });
/** Euros のキャラクターの画像(シートなど)の中身 */
export const eurosFileBytes = async (id: string, file: string) => new Uint8Array(await invoke<ArrayBuffer>("load_euros_file", { id, file }));

export const listSceneData = () => invoke<Scene[]>("list_scenes");
export const loadScene = (id: string) => invoke<Scene>("load_scene", { id });
export const saveScene = (scene: Scene) => invoke<void>("save_scene", { scene });
/** ライブラリの .trash に移す */
export const deleteScene = (id: string) => invoke<void>("delete_scene", { id });
export const openSceneFolder = (id: string) => invoke<void>("open_scene_folder", { id });

/** file は "sketches/<id>.png" か "results/<id>.png" */
export const saveSceneFile = (id: string, file: string, bytes: Uint8Array) => invoke<void>("save_scene_file", bytes, { headers: { id, file } });
export const sceneFileBytes = async (id: string, file: string) => new Uint8Array(await invoke<ArrayBuffer>("load_scene_file", { id, file }));
export const deleteSceneFile = (id: string, file: string) => invoke<void>("delete_scene_file", { id, file });
export const exportSceneFile = (id: string, file: string, path: string) => invoke<void>("export_scene_file", { id, file, path });

/** 場面の画像を <img> で見せる URL にする(使い終わったら URL.revokeObjectURL) */
export async function sceneFileUrl(id: string, file: string): Promise<string> {
  return URL.createObjectURL(new Blob([(await sceneFileBytes(id, file)) as BlobPart], { type: "image/png" }));
}
