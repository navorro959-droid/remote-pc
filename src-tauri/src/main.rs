#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use enigo::{Enigo, Key, KeyboardControllable, MouseButton, MouseControllable};
use std::sync::Mutex;
use tauri::State;

struct AppState(Mutex<Enigo>);

#[tauri::command]
fn start_connection(partner_id: String) -> String {
    println!(">>> ПОЛУЧЕНА КОМАНДА: Подключаемся к ID {} <<<", partner_id);
    format!("Готов к подключению! ID: {}", partner_id)
}

#[tauri::command]
fn move_mouse_relative(x: i32, y: i32, state: State<'_, AppState>) {
    let mut enigo = state.0.lock().unwrap();
    enigo.mouse_move_relative(x, y);
}

#[tauri::command]
fn mouse_down(button: String, state: State<'_, AppState>) {
    let mut enigo = state.0.lock().unwrap();
    let btn = if button == "left" { MouseButton::Left } else { MouseButton::Right };
    enigo.mouse_down(btn);
}

#[tauri::command]
fn mouse_up(button: String, state: State<'_, AppState>) {
    let mut enigo = state.0.lock().unwrap();
    let btn = if button == "left" { MouseButton::Left } else { MouseButton::Right };
    enigo.mouse_up(btn);
}

#[tauri::command]
fn mouse_scroll(y: i32, state: State<'_, AppState>) {
    let mut enigo = state.0.lock().unwrap();
    enigo.mouse_scroll_y(y);
}

#[tauri::command]
fn key_press(key: String, state: State<'_, AppState>) {
    let mut enigo = state.0.lock().unwrap();

    if key.chars().count() == 1 {
        let c = key.chars().next().unwrap();
        enigo.key_sequence(&c.to_string());
    } else {
        match key.as_str() {
            "Enter" => enigo.key_click(Key::Return),
            "Backspace" => enigo.key_click(Key::Backspace),
            "Tab" => enigo.key_click(Key::Tab),
            "Escape" => enigo.key_click(Key::Escape),
            " " => enigo.key_click(Key::Space),
            "ArrowUp" => enigo.key_click(Key::UpArrow),
            "ArrowDown" => enigo.key_click(Key::DownArrow),
            "ArrowLeft" => enigo.key_click(Key::LeftArrow),
            "ArrowRight" => enigo.key_click(Key::RightArrow),
            "Shift" => enigo.key_click(Key::Shift),
            "Control" => enigo.key_click(Key::Control),
            "Alt" => enigo.key_click(Key::Alt),
            "Meta" | "OS" => enigo.key_click(Key::Meta), // Поддержка клавиши Win
            _ => {}
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState(Mutex::new(Enigo::new())))
        .invoke_handler(tauri::generate_handler![
            start_connection,
            move_mouse_relative,
            mouse_down,
            mouse_up,
            mouse_scroll,
            key_press
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}