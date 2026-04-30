mod backend;

use backend::{aggregate, create_state_from_path, get_date_range, get_import_log, import_files, init_db};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use tauri::Manager;

fn log_start(msg: &str) {
    let log_path = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("sealevel.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) {
        let _ = writeln!(file, "{}", msg);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    log_start("[SeaLevel] STARTING...");

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));

    log_start(&format!("[SeaLevel] DIR: {:?}", exe_dir));

    let db_name = "sealevel.duckdb";
    let state = create_state_from_path(exe_dir.clone(), db_name);
    let db_path = exe_dir.join(db_name);
    log_start(&format!("[SeaLevel] DB: {:?}", db_path));
    log_start(&format!("[SeaLevel] DB exists at start: {}", db_path.exists()));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            app.manage(state);
            let state = app.state::<backend::AppState>();
            match init_db(state) {
                Ok(_) => log_start("[SeaLevel] DB init OK"),
                Err(e) => log_start(&format!("[SeaLevel] DB init ERROR: {}", e)),
            }
            log_start("[SeaLevel] App ready");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            init_db,
            get_date_range,
            get_import_log,
            import_files,
            aggregate,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
