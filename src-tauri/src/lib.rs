use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

/// Boreas が書くライブラリの中の置き場所。places は場所(部屋・家具)、scenes は場面
const KINDS: [&str; 2] = ["places", "scenes"];
/// Euros のキャラクターのフォルダーの中で、読んでよい画像の置き場所と拡張子
const EUROS_FILE_DIRS: [&str; 2] = ["sheets", "refs"];
/// Euros の装備品のフォルダーの中で、読んでよい画像の置き場所(デザインの画像)
const EQUIPMENT_FILE_DIRS: [&str; 4] = ["designs", "sheets", "images", "refs"];
const FILE_EXTS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];
/// 場面のフォルダーの中の画像の置き場所。sketches は下絵、results は清書の候補
const SCENE_FILE_DIRS: [&str; 2] = ["sketches", "results"];
/// 場所のフォルダーの中の画像の置き場所。designs は部屋・家具のデザイン
const PLACE_FILE_DIRS: [&str; 1] = ["designs"];

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

/// 場面(scenes/<id>/scene.json)と場所(places/<id>/place.json)。画像を置いてよいフォルダーも決める
#[derive(Clone, Copy)]
struct Kind {
    dir: &'static str,
    file: &'static str,
    /// 消したときに .trash で見分ける名前の頭
    trash: &'static str,
    file_dirs: &'static [&'static str],
}

const SCENES: Kind = Kind { dir: "scenes", file: "scene.json", trash: "scene-", file_dirs: &SCENE_FILE_DIRS };
const PLACES: Kind = Kind { dir: "places", file: "place.json", trash: "place-", file_dirs: &PLACE_FILE_DIRS };

fn entry_dir(app: &AppHandle, kind: Kind, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("invalid id".into());
    }
    Ok(library_dir(app)?.join(kind.dir).join(id))
}

fn load_entry(app: &AppHandle, kind: Kind, id: &str) -> Result<Value, String> {
    let text = fs::read_to_string(entry_dir(app, kind, id)?.join(kind.file)).map_err(err)?;
    serde_json::from_str(&text).map_err(err)
}

fn save_entry(app: &AppHandle, kind: Kind, value: &Value) -> Result<(), String> {
    let id = value.get("id").and_then(Value::as_str).ok_or("id missing")?;
    let dir = entry_dir(app, kind, id)?;
    fs::create_dir_all(&dir).map_err(err)?;
    write_json(&dir.join(kind.file), value)
}

/// 消したものは、すぐには消さずライブラリの .trash に移す
fn move_to_trash(library: &Path, kind: Kind, id: &str) -> Result<(), String> {
    let dir = library.join(kind.dir).join(id);
    if !dir.exists() {
        return Ok(());
    }
    let trash = library.join(".trash");
    fs::create_dir_all(&trash).map_err(err)?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(err)?.as_secs();
    fs::rename(&dir, trash.join(format!("{}{id}-{stamp}", kind.trash))).map_err(err)
}

/// "sketches/xxx.png" のような、決まったフォルダーの中の画像だけを許す
fn entry_file_rel<'a>(kind: Kind, file: &'a str) -> Result<(&'a str, &'a str), String> {
    let mut parts = file.split('/');
    let (Some(dir), Some(name), None) = (parts.next(), parts.next(), parts.next()) else {
        return Err("invalid file path".into());
    };
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return Err("invalid file name".into());
    };
    if !kind.file_dirs.contains(&dir) || !valid_id(stem) || !FILE_EXTS.contains(&ext.to_ascii_lowercase().as_str()) {
        return Err("invalid file path".into());
    }
    Ok((dir, name))
}

fn entry_file_path(app: &AppHandle, kind: Kind, id: &str, file: &str) -> Result<PathBuf, String> {
    let (dir, name) = entry_file_rel(kind, file)?;
    Ok(entry_dir(app, kind, id)?.join(dir).join(name))
}

/// 画像の中身をそのまま受け取る(id と file はヘッダーで渡す)
fn save_entry_file(app: &AppHandle, kind: Kind, request: &tauri::ipc::Request) -> Result<(), String> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
            .ok_or_else(|| format!("missing {name}"))
    };
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("file bytes expected".into());
    };
    let path = entry_file_path(app, kind, &header("id")?, &header("file")?)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    fs::write(path, bytes).map_err(err)
}

fn open_entry_folder(app: &AppHandle, kind: Kind, id: &str) -> Result<(), String> {
    let dir = entry_dir(app, kind, id)?;
    fs::create_dir_all(&dir).map_err(err)?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(err)
}

#[tauri::command]
fn list_scenes(app: AppHandle) -> Result<Vec<Value>, String> {
    Ok(list_entries_in(&library_dir(&app)?, SCENES.dir, SCENES.file))
}

#[tauri::command]
fn load_scene(app: AppHandle, id: String) -> Result<Value, String> {
    load_entry(&app, SCENES, &id)
}

#[tauri::command]
fn save_scene(app: AppHandle, scene: Value) -> Result<(), String> {
    save_entry(&app, SCENES, &scene)
}

#[tauri::command]
fn delete_scene(app: AppHandle, id: String) -> Result<(), String> {
    entry_dir(&app, SCENES, &id)?;
    move_to_trash(&library_dir(&app)?, SCENES, &id)
}

#[tauri::command]
fn save_scene_file(app: AppHandle, request: tauri::ipc::Request) -> Result<(), String> {
    save_entry_file(&app, SCENES, &request)
}

#[tauri::command]
fn load_scene_file(app: AppHandle, id: String, file: String) -> Result<tauri::ipc::Response, String> {
    let bytes = fs::read(entry_file_path(&app, SCENES, &id, &file)?).map_err(err)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn delete_scene_file(app: AppHandle, id: String, file: String) -> Result<(), String> {
    let path = entry_file_path(&app, SCENES, &id, &file)?;
    if path.exists() {
        fs::remove_file(path).map_err(err)?;
    }
    Ok(())
}

/// 清書の画像を、選んだ場所に書き出す
#[tauri::command]
fn export_scene_file(app: AppHandle, id: String, file: String, path: String) -> Result<(), String> {
    fs::copy(entry_file_path(&app, SCENES, &id, &file)?, path).map_err(err)?;
    Ok(())
}

/// 場面のフォルダーをエクスプローラーで開く
#[tauri::command]
fn open_scene_folder(app: AppHandle, id: String) -> Result<(), String> {
    open_entry_folder(&app, SCENES, &id)
}

#[tauri::command]
fn list_places(app: AppHandle) -> Result<Vec<Value>, String> {
    Ok(list_entries_in(&library_dir(&app)?, PLACES.dir, PLACES.file))
}

#[tauri::command]
fn load_place(app: AppHandle, id: String) -> Result<Value, String> {
    load_entry(&app, PLACES, &id).map_err(|_| "場所が見つかりません".to_string())
}

#[tauri::command]
fn save_place(app: AppHandle, place: Value) -> Result<(), String> {
    save_entry(&app, PLACES, &place)
}

/// 場所を消しても、その場所を使う場面は残す(場面からは「場所が見つかりません」と出る)
#[tauri::command]
fn delete_place(app: AppHandle, id: String) -> Result<(), String> {
    entry_dir(&app, PLACES, &id)?;
    move_to_trash(&library_dir(&app)?, PLACES, &id)
}

#[tauri::command]
fn save_place_file(app: AppHandle, request: tauri::ipc::Request) -> Result<(), String> {
    save_entry_file(&app, PLACES, &request)
}

#[tauri::command]
fn load_place_file(app: AppHandle, id: String, file: String) -> Result<tauri::ipc::Response, String> {
    let bytes = fs::read(entry_file_path(&app, PLACES, &id, &file)?).map_err(err)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn open_place_folder(app: AppHandle, id: String) -> Result<(), String> {
    open_entry_folder(&app, PLACES, &id)
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
        "notHuman": c.pointer("/sheet/notHuman").and_then(Value::as_bool).unwrap_or(false),
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

/// Euros のキャラクターを丸ごと読む(書き換えない)
#[tauri::command]
fn load_euros_character(app: AppHandle, id: String) -> Result<Value, String> {
    if !valid_id(&id) {
        return Err("invalid id".into());
    }
    let path = euros_library(&app)?.join("characters").join(&id).join("character.json");
    let text = fs::read_to_string(path).map_err(|_| "Euros のキャラクターが見つかりません".to_string())?;
    serde_json::from_str(&text).map_err(err)
}

/// "sheets/xxx.png" のような、キャラクターのフォルダーの中の画像だけを許す
fn euros_file_path(euros: &Path, id: &str, file: &str) -> Result<PathBuf, String> {
    euros_entry_file(euros, "characters", &EUROS_FILE_DIRS, id, file)
}

/// "designs/xxx.png" のような、装備品のフォルダーの中の画像だけを許す
fn equipment_file_path(euros: &Path, id: &str, file: &str) -> Result<PathBuf, String> {
    euros_entry_file(euros, "equipment", &EQUIPMENT_FILE_DIRS, id, file)
}

fn euros_entry_file(euros: &Path, kind: &str, dirs: &[&str], id: &str, file: &str) -> Result<PathBuf, String> {
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
    if !dirs.contains(&dir) || !valid_id(stem) || !FILE_EXTS.contains(&ext.to_ascii_lowercase().as_str()) {
        return Err("invalid file path".into());
    }
    Ok(euros.join(kind).join(id).join(dir).join(name))
}

#[tauri::command]
fn load_euros_file(app: AppHandle, id: String, file: String) -> Result<tauri::ipc::Response, String> {
    let bytes = fs::read(euros_file_path(&euros_library(&app)?, &id, &file)?).map_err(err)?;
    Ok(tauri::ipc::Response::new(bytes))
}

// ---------------------------------------------------------------- Euros の装備品(読むだけ)

/// equipment/<id>/equipment.json を新しい順に並べる(形式は Euros の docs/character-format.md)
fn list_equipment_in(euros: &Path) -> Vec<Value> {
    let mut list: Vec<Value> = list_entries_in(euros, "equipment", "equipment.json")
        .into_iter()
        .filter(|e| e.get("app").and_then(Value::as_str) == Some("Euros"))
        .collect();
    list.retain(|e| e.get("id").and_then(Value::as_str).is_some_and(valid_id));
    list
}

/// 装備品は小さいので、一覧でも中身を丸ごと返す
#[tauri::command]
fn list_euros_equipment(app: AppHandle) -> Result<Vec<Value>, String> {
    Ok(list_equipment_in(&euros_library(&app)?))
}

#[tauri::command]
fn load_euros_equipment_file(app: AppHandle, id: String, file: String) -> Result<tauri::ipc::Response, String> {
    let bytes = fs::read(equipment_file_path(&euros_library(&app)?, &id, &file)?).map_err(err)?;
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
            load_scene,
            save_scene,
            delete_scene,
            save_scene_file,
            load_scene_file,
            delete_scene_file,
            export_scene_file,
            open_scene_folder,
            list_places,
            load_place,
            save_place,
            delete_place,
            save_place_file,
            load_place_file,
            open_place_folder,
            list_euros_characters,
            load_euros_character,
            load_euros_file,
            list_euros_equipment,
            load_euros_equipment_file
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
        assert_eq!(list[1]["notHuman"], false);
    }

    #[test]
    fn lists_euros_equipment_and_skips_broken_ones() {
        let euros = temp("equipment");
        let put = |id: &str, text: String| {
            let dir = euros.join("equipment").join(id);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("equipment.json"), text).unwrap();
        };
        put("bat", json!({ "app": "Euros", "id": "bat", "updatedAt": "2026-01-01", "name": "金属バット", "shape": "bat", "size": { "lengthCm": 84 } }).to_string());
        put("bad", "{".into());
        put("other", json!({ "app": "Other", "id": "other" }).to_string());
        put("evil", json!({ "app": "Euros", "id": "../x" }).to_string());
        let list = list_equipment_in(&euros);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["size"]["lengthCm"], 84);
    }

    #[test]
    fn equipment_file_path_stays_inside_the_equipment() {
        let euros = Path::new("lib");
        assert_eq!(equipment_file_path(euros, "bat", "designs/r1.png").unwrap(), euros.join("equipment/bat/designs/r1.png"));
        assert!(equipment_file_path(euros, "bat", "../c2/designs/r1.png").is_err());
        assert!(equipment_file_path(euros, "..", "designs/r1.png").is_err());
        assert!(equipment_file_path(euros, "bat", "equipment.json").is_err());
        assert!(equipment_file_path(euros, "bat", "designs/r1.exe").is_err());
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
    fn scene_files_stay_inside_the_scene() {
        assert_eq!(entry_file_rel(SCENES, "sketches/t1.png").unwrap(), ("sketches", "t1.png"));
        assert!(entry_file_rel(SCENES, "results/t1.png").is_ok());
        assert!(entry_file_rel(SCENES, "../x.png").is_err());
        assert!(entry_file_rel(SCENES, "results/../../x.png").is_err());
        assert!(entry_file_rel(SCENES, "scene.json").is_err());
        assert!(entry_file_rel(SCENES, "designs/a.png").is_err());
    }

    #[test]
    fn place_files_stay_inside_the_place() {
        assert_eq!(entry_file_rel(PLACES, "designs/d1.png").unwrap(), ("designs", "d1.png"));
        assert!(entry_file_rel(PLACES, "sketches/t1.png").is_err());
        assert!(entry_file_rel(PLACES, "designs/../../x.png").is_err());
        assert!(entry_file_rel(PLACES, "place.json").is_err());
        assert!(entry_file_rel(PLACES, "designs/d1.exe").is_err());
    }

    #[test]
    fn trashed_scenes_leave_the_list() {
        let lib = temp("trash");
        let dir = lib.join("scenes/s1");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("scene.json"), json!({ "id": "s1" }).to_string()).unwrap();
        assert_eq!(list_entries_in(&lib, "scenes", "scene.json").len(), 1);
        move_to_trash(&lib, SCENES, "s1").unwrap();
        assert!(list_entries_in(&lib, "scenes", "scene.json").is_empty());
        assert!(fs::read_dir(lib.join(".trash")).unwrap().flatten().any(|e| e.file_name().to_string_lossy().starts_with("scene-s1-")));
    }

    #[test]
    fn trashed_places_leave_the_list() {
        let lib = temp("trash-place");
        let dir = lib.join("places/p1");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("place.json"), json!({ "id": "p1", "app": "Boreas" }).to_string()).unwrap();
        assert_eq!(list_entries_in(&lib, PLACES.dir, PLACES.file).len(), 1);
        move_to_trash(&lib, PLACES, "p1").unwrap();
        assert!(list_entries_in(&lib, PLACES.dir, PLACES.file).is_empty());
        assert!(fs::read_dir(lib.join(".trash")).unwrap().flatten().any(|e| e.file_name().to_string_lossy().starts_with("place-p1-")));
    }

    #[test]
    fn missing_folders_give_empty_lists() {
        let lib = temp("empty");
        assert!(list_entries_in(&lib, "scenes", "scene.json").is_empty());
        assert!(list_characters_in(&lib.join("nowhere")).is_empty());
    }
}
