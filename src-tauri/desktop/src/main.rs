// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Fix PATH environment variable for GUI apps
    // This ensures user's shell config (e.g., ~/.zshrc) is loaded
    let _ = fix_path_env::fix();
    talkcody_desktop_lib::run()
}
