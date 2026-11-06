//! Opened EPUB archives and the `turn://` protocol that serves their entries.
//!
//! The frontend never receives the whole file. It asks for the entry list once
//! (`open_book`), then fetches individual entries on demand from
//! `http://turn.localhost/<book-id>/<entry-path>` (how WebView2 exposes custom
//! schemes, on Windows and Android alike). Each request is answered from a
//! worker thread so a large image never blocks the UI.
//!
//! On Android, books arrive as `content://` URIs that are only readable for a
//! while, so they are first copied into the app's own storage (`import_book`).

use std::{
    collections::HashMap,
    fs::File,
    io::{BufReader, Read},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, RwLock,
    },
};

use percent_encoding::percent_decode_str;
use serde::Serialize;
use tauri::{
    http::{header, Request, Response, StatusCode},
    AppHandle, Manager, Runtime, State, UriSchemeContext, UriSchemeResponder,
};
use zip::ZipArchive;

struct Book {
    archive: Mutex<ZipArchive<BufReader<File>>>,
    index: HashMap<String, usize>,
}

impl Book {
    fn read(&self, name: &str) -> Option<Vec<u8>> {
        let i = *self.index.get(name)?;
        let mut archive = self.archive.lock().ok()?;
        let mut file = archive.by_index(i).ok()?;
        let mut buf = Vec::with_capacity(file.size() as usize);
        file.read_to_end(&mut buf).ok()?;
        Some(buf)
    }
}

#[derive(Default)]
pub struct Books {
    next: AtomicU64,
    map: RwLock<HashMap<u64, Arc<Book>>>,
}

impl Books {
    fn get(&self, id: u64) -> Option<Arc<Book>> {
        self.map.read().ok()?.get(&id).cloned()
    }
}

#[derive(Serialize)]
pub struct Entry {
    name: String,
    size: u64,
}

#[derive(Serialize)]
pub struct Opened {
    id: u64,
    entries: Vec<Entry>,
}

fn open_archive(path: &str) -> Result<(Book, Vec<Entry>), String> {
    let file = File::open(path).map_err(|e| format!("无法读取文件：{e}"))?;
    let mut archive =
        ZipArchive::new(BufReader::new(file)).map_err(|_| "不是有效的 EPUB 文件".to_string())?;
    let mut index = HashMap::with_capacity(archive.len());
    let mut entries = Vec::with_capacity(archive.len());
    for i in 0..archive.len() {
        let Ok(f) = archive.by_index_raw(i) else { continue };
        if f.is_dir() {
            continue;
        }
        let Ok(name) = f.name().map(|n| n.into_owned()) else { continue };
        entries.push(Entry { name: name.clone(), size: f.size() });
        index.insert(name, i);
    }
    Ok((Book { archive: Mutex::new(archive), index }, entries))
}

#[tauri::command]
pub async fn open_book(path: String, books: State<'_, Books>) -> Result<Opened, String> {
    let (book, entries) = tauri::async_runtime::spawn_blocking(move || open_archive(&path))
        .await
        .map_err(|e| e.to_string())??;
    let id = books.next.fetch_add(1, Ordering::Relaxed) + 1;
    books.map.write().map_err(|e| e.to_string())?.insert(id, Arc::new(book));
    Ok(Opened { id, entries })
}

#[tauri::command]
pub fn close_book(id: u64, books: State<'_, Books>) {
    if let Ok(mut map) = books.map.write() {
        map.remove(&id);
    }
}

fn respond(responder: UriSchemeResponder, status: StatusCode, body: Vec<u8>, mime: &str) {
    let res = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()));
    responder.respond(res);
}

fn mime_of(name: &str) -> &'static str {
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "xhtml" | "xht" => "application/xhtml+xml",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "xml" | "opf" | "ncx" => "application/xml",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "mp3" => "audio/mpeg",
        "mp4" | "m4a" => "audio/mp4",
        _ => "application/octet-stream",
    }
}

pub fn protocol<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    req: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let path = req.uri().path().trim_start_matches('/');
    let (id, name) = path.split_once('/').unwrap_or((path, ""));
    let name = percent_decode_str(name).decode_utf8_lossy().into_owned();
    let book = id.parse().ok().and_then(|id| ctx.app_handle().state::<Books>().get(id));
    let Some(book) = book else {
        return respond(responder, StatusCode::NOT_FOUND, Vec::new(), "text/plain");
    };
    tauri::async_runtime::spawn_blocking(move || match book.read(&name) {
        Some(bytes) => respond(responder, StatusCode::OK, bytes, mime_of(&name)),
        None => respond(responder, StatusCode::NOT_FOUND, Vec::new(), "text/plain"),
    });
}

/// First `.epub` path among command-line arguments (file association / "Open with").
pub fn epub_arg<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter()
        .skip(1)
        .find(|a| a.to_ascii_lowercase().ends_with(".epub") && Path::new(a).is_file())
}

// ── Imported books (Android) ────────────────────────────────────────────────

/// Where imported books live. Turn owns everything in here.
fn library_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("books"))
}

#[cfg(target_os = "android")]
/// FNV-1a: a stable content hash, so importing the same book twice reuses one
/// copy (and its reading position).
struct Fnv(u64);

#[cfg(target_os = "android")]
impl Fnv {
    fn new() -> Self {
        Self(0xcbf2_9ce4_8422_2325)
    }
    fn update(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.0 = (self.0 ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3);
        }
    }
}

#[cfg(target_os = "android")]
fn import<R: Runtime>(app: &AppHandle<R>, uri: &str) -> Result<String, String> {
    use std::io::Write;
    use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};

    let url = tauri::Url::parse(uri).map_err(|e| e.to_string())?;
    let source = match url.scheme() {
        "file" => FilePath::Path(url.to_file_path().map_err(|_| "无效的文件路径".to_string())?),
        _ => FilePath::Url(url),
    };
    let mut opts = OpenOptions::new();
    opts.read(true);
    let mut src = app.fs().open(source, opts).map_err(|e| format!("无法读取文件：{e}"))?;

    let dir = library_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let tmp = dir.join(format!(".import-{}", NEXT.fetch_add(1, Ordering::Relaxed)));
    let mut copy = || -> std::io::Result<u64> {
        let mut out = File::create(&tmp)?;
        let mut hash = Fnv::new();
        let mut buf = vec![0; 256 * 1024];
        loop {
            let n = src.read(&mut buf)?;
            if n == 0 {
                break;
            }
            hash.update(&buf[..n]);
            out.write_all(&buf[..n])?;
        }
        out.sync_all()?;
        Ok(hash.0)
    };
    let hash = match copy() {
        Ok(h) => h,
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("无法读取文件：{e}"));
        }
    };

    let is_epub = File::open(&tmp)
        .ok()
        .and_then(|f| ZipArchive::new(BufReader::new(f)).ok())
        .is_some_and(|mut a| a.by_name("META-INF/container.xml").is_ok());
    if !is_epub {
        let _ = std::fs::remove_file(&tmp);
        return Err("不是有效的 EPUB 文件".into());
    }

    let dest = dir.join(format!("{hash:016x}.epub"));
    if dest.is_file() {
        let _ = std::fs::remove_file(&tmp);
    } else {
        std::fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
    }
    Ok(dest.to_string_lossy().into_owned())
}

/// Copies a book handed over by the system (`content://` or `file://` URI) into
/// Turn's storage and returns its path.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn import_book<R: Runtime>(app: AppHandle<R>, uri: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || import(&app, &uri))
        .await
        .map_err(|e| e.to_string())?
}

/// Desktop opens files where they are; there is nothing to import.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn import_book(uri: String) -> Result<String, String> {
    Ok(uri)
}

/// Called when a book leaves the bookshelf. Deletes it only if it is Turn's own
/// imported copy; files elsewhere (all of them on desktop) are never touched.
#[tauri::command]
pub fn forget_book<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let path = Path::new(&path);
    let ours = path.parent() == Some(library_dir(&app)?.as_path())
        && path.extension().is_some_and(|e| e == "epub");
    if ours {
        match std::fs::remove_file(path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.to_string()),
            _ => {}
        }
    }
    Ok(())
}
