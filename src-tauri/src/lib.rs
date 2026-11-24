use std::{
    fs,
    path::{Path, PathBuf},
};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

/// Boreas が書くライブラリの中の置き場所。places は場所(部屋・家具)、scenes は場面
const KINDS: [&str; 2] = ["places", "scenes"];
/// Euros のキャラクターのフォルダーの中で、読んでよい画像の置き場所と拡張子
const EUROS_FILE_DIRS: [&str; 2] = ["sheets", "refs"];
const FILE_EXTS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

// ---------------------------------------------------------------- 設定

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(err)?;
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.join("settings.json"))
}

fn read_settings(app: &AppHandle) -> Result<Value, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(Value::Null);
    }
    let text = fs::read_to_string(path).map_err(err)?;
    serde_json::from_str(&text).map_err(err)
}

/// 設定。まだファイルがなければ null(WebView の localStorage は壊れて消えることがあるため、ファイルにする)
#[tauri::command]
fn load_settings(app: AppHandle) -> Result<Value, String> {
    read_settings(&app)
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Value) -> Result<(), String> {
    write_json(&settings_path(&app)?, &settings)
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(value).map_err(err)?;
    fs::write(&tmp, text).map_err(err)?;
    fs::rename(&tmp, path).map_err(err)
}

/// 設定で選んだフォルダー。未設定なら default
fn chosen_dir(app: &AppHandle, key: &str, default: PathBuf) -> Result<PathBuf, String> {
    let chosen = read_settings(app)?
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
    Ok(chosen.unwrap_or(default))
}

// ---------------------------------------------------------------- 場所

/// Boreas のライブラリ。既定は %APPDATA%\Boreas\library
fn default_library(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().data_dir().map_err(err)?.join("Boreas").join("library"))
}

fn library_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = chosen_dir(app, "libraryDir", default_library(app)?)?;
    for kind in KINDS {
        fs::create_dir_all(dir.join(kind)).map_err(err)?;
    }
    Ok(dir)
}

/// Euros のライブラリ(読むだけ)。既定は %APPDATA%\Euros\library
fn default_euros_library(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().data_dir().map_err(err)?.join("Euros").join("library"))
}

fn euros_library(app: &AppHandle) -> Result<PathBuf, String> {
    chosen_dir(app, "eurosLibraryDir", default_euros_library(app)?)
}

/// Notos のデータ(読むだけ)。既定は %APPDATA%\io.github.kurone-hinamori.notos
fn default_notos_data(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().data_dir().map_err(err)?.join("io.github.kurone-hinamori.notos"))
}

fn notos_data(app: &AppHandle) -> Result<PathBuf, String> {
    chosen_dir(app, "notosDataDir", default_notos_data(app)?)
}

fn folder(path: &Path, default: &Path) -> Value {
    json!({
        "path": path.to_string_lossy(),
        "defaultPath": default.to_string_lossy(),
        "exists": path.is_dir(),
    })
}

#[tauri::command]
fn folders(app: AppHandle) -> Result<Value, String> {
    Ok(json!({
        "library": folder(&library_dir(&app)?, &default_library(&app)?),
        "euros": folder(&euros_library(&app)?, &default_euros_library(&app)?),
        "notos": folder(&notos_data(&app)?, &default_notos_data(&app)?),
    }))
}

/// which は "library"・"euros"・"notos" のどれか
#[tauri::command]
fn open_folder(app: AppHandle, which: String) -> Result<(), String> {
    let dir = match which.as_str() {
        "library" => library_dir(&app)?,
        "euros" => euros_library(&app)?,
        "notos" => notos_data(&app)?,
        _ => return Err("invalid folder".into()),
    };
    if !dir.is_dir() {
        return Err("フォルダーがありません".into());
    }
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(err)
}

// ---------------------------------------------------------------- 場面と場所

/// <kind>/<id>/<file> の中身を新しい順に並べる。読めないものは飛ばす
fn list_entries_in(library: &Path, kind: &str, file: &str) -> Vec<Value> {
    let mut list = Vec::new();
    let Ok(entries) = fs::read_dir(library.join(kind)) else { return list };
    for entry in entries.flatten() {
        let Ok(text) = fs::read_to_string(entry.path().join(file)) else { continue };
        if let Ok(o) = serde_json::from_str::<Value>(&text) {
            list.push(o);
        }
    }
    list.sort_by(|a, b| {
        let key = |v: &Value| v.get("updatedAt").and_then(Value::as_str).unwrap_or("").to_string();
        key(b).cmp(&key(a))
    });
    list
}

#[tauri::command]
fn list_scenes(app: AppHandle) -> Result<Vec<Value>, String> {
    Ok(list_entries_in(&library_dir(&app)?, "scenes", "scene.json"))
}

#[tauri::command]
fn list_places(app: AppHandle) -> Result<Vec<Value>, String> {
    Ok(list_entries_in(&library_dir(&app)?, "places", "place.json"))
}

// ---------------------------------------------------------------- Euros のキャラクター(読むだけ)

/// 一覧に出す分だけを取り出す(形式は Euros の docs/character-format.md)
fn summarize_character(c: &Value) -> Value {
    let current = c.get("currentRevision").and_then(Value::as_str);
    let sheet = c
        .get("revisions")
        .and_then(Value::as_array)
        .and_then(|revs| revs.iter().find(|r| r.get("id").and_then(Value::as_str) == current))
        .and_then(|r| r.get("image"))
        .cloned()
        .unwrap_or(Value::Null);
    json!({
        "id": c.get("id"),
        "name": c.pointer("/profile/name"),
        "reading": c.pointer("/profile/reading"),
        "updatedAt": c.get("updatedAt"),
        "sheet": sheet,
    })
}

fn list_characters_in(euros: &Path) -> Vec<Value> {
    let mut list: Vec<Value> = list_entries_in(euros, "characters", "character.json")
        .iter()
        .filter(|c| c.get("app").and_then(Value::as_str) == Some("Euros"))
        .map(summarize_character)
        .collect();
    list.retain(|c| c.get("id").and_then(Value::as_str).is_some_and(valid_id));
    list
}

#[tauri::command]
fn list_euros_characters(app: AppHandle) -> Result<Vec<Value>, String> {
    Ok(list_characters_in(&euros_library(&app)?))
}

/// "sheets/xxx.png" のような、キャラクターのフォルダーの中の画像だけを許す
fn euros_file_path(euros: &Path, id: &str, file: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("invalid id".into());
    }
    let mut parts = file.split('/');
    let (Some(dir), Some(name), None) = (parts.next(), parts.next(), parts.next()) else {
        return Err("invalid file path".into());
    };
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return Err("invalid file name".into());
    };
    if !EUROS_FILE_DIRS.contains(&dir) || !valid_id(stem) || !FILE_EXTS.contains(&ext.to_ascii_lowercase().as_str()) {
        return Err("invalid file path".into());
    }
    Ok(euros.join("characters").join(id).join(dir).join(name))
}

#[tauri::command]
fn load_euros_file(app: AppHandle, id: String, file: String) -> Result<tauri::ipc::Response, String> {
    let bytes = fs::read(euros_file_path(&euros_library(&app)?, &id, &file)?).map_err(err)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init());

    // ウィンドウの位置とサイズは、終了時に保存して次回の起動時に復元する
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build());

    builder
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            folders,
            open_folder,
            list_scenes,
            list_places,
            list_euros_characters,
            load_euros_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Boreas");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("boreas-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn lists_euros_characters_and_skips_broken_ones() {
        let euros = temp("euros");
        let put = |id: &str, text: String| {
            let dir = euros.join("characters").join(id);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("character.json"), text).unwrap();
        };
        put("c1", json!({ "app": "Euros", "id": "c1", "updatedAt": "2026-01-01", "profile": { "name": "天音 鈴" }, "revisions": [{ "id": "r1", "image": "sheets/r1.png" }], "currentRevision": "r1" }).to_string());
        put("c2", json!({ "app": "Euros", "id": "c2", "updatedAt": "2026-02-01", "profile": { "name": "b" } }).to_string());
        put("bad", "{".into());
        put("other", json!({ "app": "Other", "id": "other" }).to_string());
        let list = list_characters_in(&euros);
        let ids: Vec<&Value> = list.iter().map(|c| &c["id"]).collect();
        assert_eq!(ids, [&json!("c2"), &json!("c1")]);
        assert_eq!(list[1]["sheet"], "sheets/r1.png");
        assert_eq!(list[1]["name"], "天音 鈴");
    }

    #[test]
    fn euros_file_path_stays_inside_the_character() {
        let euros = Path::new("lib");
        assert!(euros_file_path(euros, "c1", "sheets/r1.png").is_ok());
        assert!(euros_file_path(euros, "c1", "../c2/sheets/r1.png").is_err());
        assert!(euros_file_path(euros, "c1", "sheets/../../x.png").is_err());
        assert!(euros_file_path(euros, "..", "sheets/r1.png").is_err());
        assert!(euros_file_path(euros, "c1", "character.json").is_err());
        assert!(euros_file_path(euros, "c1", "sheets/r1.exe").is_err());
    }

    #[test]
    fn missing_folders_give_empty_lists() {
        let lib = temp("empty");
        assert!(list_entries_in(&lib, "scenes", "scene.json").is_empty());
        assert!(list_characters_in(&lib.join("nowhere")).is_empty());
    }
}
