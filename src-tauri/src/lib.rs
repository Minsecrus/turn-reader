mod books;
#[cfg(windows)]
mod icon;
mod store;

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

/// A file to open that the frontend hasn't picked up yet: the one Turn was
/// launched with, or one handed over while running. On Android it's a
/// `content://` URI that the frontend imports first.
struct PendingFile(Mutex<Option<String>>);

#[tauri::command]
fn take_pending_file(pending: State<'_, PendingFile>) -> Option<String> {
    pending.0.lock().ok()?.take()
}

/// Queues a file and tells the frontend. It may not be listening yet (cold
/// start), so it asks for the file instead of getting it in the event.
fn hand_over(app: &AppHandle, file: String) {
    if let Ok(mut pending) = app.state::<PendingFile>().0.lock() {
        *pending = Some(file);
    }
    let _ = app.emit("open-file", ());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder
        // Must be registered first: a second launch (e.g. double-clicking another
        // .epub) forwards its file to the running window instead of opening a new one.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = books::epub_arg(argv) {
                hand_over(app, path);
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
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        );

    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_fs::init());

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(books::Books::default())
        .manage(PendingFile(Mutex::new(books::epub_arg(std::env::args()))))
        .register_asynchronous_uri_scheme_protocol("turn", books::protocol)
        .setup(|_app| {
            #[cfg(windows)]
            if let Some(window) = _app.get_webview_window("main") {
                icon::apply(&window);
                let w = window.clone();
                window.on_window_event(move |e| {
                    if let tauri::WindowEvent::ScaleFactorChanged { .. } = e {
                        icon::apply(&w);
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            books::open_book,
            books::close_book,
            books::import_book,
            books::forget_book,
            store::load_state,
            store::save_state,
            take_pending_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Turn")
        .run(on_event);
}

#[cfg(target_os = "android")]
fn on_event(app: &AppHandle, event: RunEvent) {
    // "Open with" / "Share" from another app, at launch or while running.
    if let RunEvent::Opened { urls } = event {
        if let Some(url) = urls.into_iter().find(|u| matches!(u.scheme(), "content" | "file")) {
            hand_over(app, url.to_string());
        }
    }
}

#[cfg(not(target_os = "android"))]
fn on_event(_app: &AppHandle, _event: RunEvent) {}
