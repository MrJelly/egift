mod lan_server;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .manage(lan_server::LanServerState::default())
    .invoke_handler(tauri::generate_handler![
      lan_server::start_lan_server,
      lan_server::update_lan_snapshot,
      lan_server::lan_server_status,
      lan_server::stop_lan_server
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
