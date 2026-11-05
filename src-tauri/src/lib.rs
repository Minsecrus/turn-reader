mod books;
#[cfg(windows)]
mod icon;
mod store;

use std::sync::Mutex;

use tauri::{Emitter, Manager, State, WindowEvent};
use tauri_plugin_window_state::StateFlags;

/// The file passed on the command line at launch; handed to the frontend once.
struct LaunchFile(Mutex<Option<String>>);

#[tauri::command]
fn launch_file(launch: State<'_, LaunchFile>) -> Option<String> {
    launch.0.lock().ok()?.take()
}

pub fn run() {
    tauri::Builder::default()
        // Must be registered first: a second launch (e.g. double-clicking another
        // .epub) forwards its file to the running window instead of opening a new one.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = books::epub_arg(argv) {
                let _ = app.emit("open-file", path);
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::new()
                // The window starts hidden and is shown by the frontend after first paint.
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(books::Books::default())
        .manage(LaunchFile(Mutex::new(books::epub_arg(std::env::args()))))
        .register_asynchronous_uri_scheme_protocol("turn", books::protocol)
        .setup(|app| {
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                icon::apply(&window);
                let w = window.clone();
                window.on_window_event(move |e| {
                    if let WindowEvent::ScaleFactorChanged { .. } = e {
                        icon::apply(&w);
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            books::open_book,
            books::close_book,
            store::load_state,
            store::save_state,
            launch_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Turn");
}
