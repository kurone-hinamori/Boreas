import { invoke } from "@tauri-apps/api/core";
import type { CharacterSummary, Folders, Settings } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import type { EurosCharacter, Scene } from "./scene";
import type { EurosEquipment } from "./props";
import type { Place } from "./place";

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

/** Euros の装備品(読むだけ) */
export const listEurosEquipment = () => invoke<EurosEquipment[]>("list_euros_equipment");
/** 装備品の画像(デザイン)の中身 */
export const equipmentFileBytes = async (id: string, file: string) => new Uint8Array(await invoke<ArrayBuffer>("load_euros_equipment_file", { id, file }));

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

// ---------------------------------------------------------------- 場所

export const listPlaceData = () => invoke<Place[]>("list_places");
export const loadPlace = (id: string) => invoke<Place>("load_place", { id });
export const savePlace = (place: Place) => invoke<void>("save_place", { place });
/** ライブラリの .trash に移す */
export const deletePlace = (id: string) => invoke<void>("delete_place", { id });
export const openPlaceFolder = (id: string) => invoke<void>("open_place_folder", { id });

/** file は "designs/<id>.png"(部屋・家具のデザイン) */
export const savePlaceFile = (id: string, file: string, bytes: Uint8Array) => invoke<void>("save_place_file", bytes, { headers: { id, file } });
export const placeFileBytes = async (id: string, file: string) => new Uint8Array(await invoke<ArrayBuffer>("load_place_file", { id, file }));

export async function placeFileUrl(id: string, file: string): Promise<string> {
  return URL.createObjectURL(new Blob([(await placeFileBytes(id, file)) as BlobPart], { type: "image/png" }));
}
