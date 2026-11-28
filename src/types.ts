export interface Settings {
  /** 清書に使う ComfyUI の URL */
  comfyUrl: string;
  /** 日本語からプロンプトを作る Ollama */
  ollamaUrl: string;
  model: string;
  /** Boreas の保存先。空なら %APPDATA%\Boreas\library */
  libraryDir: string;
  /** Euros のライブラリ(読むだけ)。空なら %APPDATA%\Euros\library */
  eurosLibraryDir: string;
  /** Notos のデータ(読むだけ)。空なら %APPDATA%\io.github.kurone-hinamori.notos */
  notosDataDir: string;
}

export const DEFAULT_SETTINGS: Settings = {
  comfyUrl: "http://127.0.0.1:8188",
  ollamaUrl: "http://127.0.0.1:11434",
  model: "",
  libraryDir: "",
  eurosLibraryDir: "",
  notosDataDir: "",
};

export interface Folder {
  path: string;
  defaultPath: string;
  exists: boolean;
}

export interface Folders {
  library: Folder;
  euros: Folder;
  notos: Folder;
}

/** Euros のキャラクターの一覧に出す分 */
export interface CharacterSummary {
  id: string;
  name: string | null;
  reading: string | null;
  updatedAt: string | null;
  /** いまの版のシート("sheets/<id>.png")。まだなければ null */
  sheet: string | null;
  /** 人ではない登場人物(Euros の sheet.notHuman) */
  notHuman: boolean;
}
