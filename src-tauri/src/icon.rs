//! Crisp window icons on high-DPI displays.
//!
//! Tauri sets only the small window icon, created at startup before the process
//! is DPI-aware, so it is always 32×32. Without a large icon the taskbar
//! stretches that one (e.g. to 48px at 200% scaling) and it looks blurry.
//! Here both icons are loaded from the exe's icon resource at the exact size
//! for the window's current DPI, and reloaded when the DPI changes.

use tauri::{utils::platform::WINDOWS_APP_ICON_RESOURCE_ID, WebviewWindow};
use windows_sys::Win32::{
    Foundation::HWND,
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi},
        WindowsAndMessaging::{
            LoadImageW, SendMessageW, ICON_BIG, ICON_SMALL, IMAGE_ICON, LR_DEFAULTCOLOR,
            SM_CXICON, SM_CXSMICON, WM_SETICON,
        },
    },
};

pub fn apply(window: &WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else { return };
    let hwnd = hwnd.0 as HWND;
    unsafe {
        let dpi = GetDpiForWindow(hwnd);
        if dpi == 0 {
            return;
        }
        let module = GetModuleHandleW(std::ptr::null());
        for (kind, metric) in [(ICON_BIG, SM_CXICON), (ICON_SMALL, SM_CXSMICON)] {
            let size = GetSystemMetricsForDpi(metric, dpi);
            // MAKEINTRESOURCEW: the resource id passed as a pointer value.
            let id = WINDOWS_APP_ICON_RESOURCE_ID as usize as *const u16;
            let icon = LoadImageW(module, id, IMAGE_ICON, size, size, LR_DEFAULTCOLOR);
            // The previous icons are not destroyed: the first ones belong to Tauri,
            // and a DPI change is rare enough that keeping a few KB is fine.
            if !icon.is_null() {
                SendMessageW(hwnd, WM_SETICON, kind as usize, icon as isize);
            }
        }
    }
}
