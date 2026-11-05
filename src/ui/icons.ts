const svg = (body: string, size = 18) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

export const icons = {
  library: svg('<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H8v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M8 4h3.5v16H8"/><path d="m14.2 5.2 2.9-.8 3.6 13.6-2.9.8z"/>'),
  open: svg('<path d="M4 7.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9.5a2 2 0 0 0-2-2h-6.2L9.6 5H6a2 2 0 0 0-2 2.5"/>'),
  toc: svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".6" fill="currentColor"/><circle cx="4.5" cy="12" r=".6" fill="currentColor"/><circle cx="4.5" cy="18" r=".6" fill="currentColor"/>'),
  type: svg('<path d="M3.5 18 8 6h1l4.5 12"/><path d="M5.2 14h6.6"/><path d="M15 11.2c.7-.8 1.6-1.2 2.7-1.2 1.8 0 2.8 1 2.8 2.8V18"/><path d="M20.5 14.2c-.8-.3-1.6-.4-2.4-.4-1.7 0-3 .8-3 2.2 0 1.2.9 2 2.3 2 1.4 0 2.6-.8 3.1-2"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>', 14),
  winMin: '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" stroke="currentColor" stroke-width="1"/></svg>',
  winMax: '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x=".5" y=".5" width="9" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
  winRestore:
    '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x=".5" y="2.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1"/><path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
  winClose: '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0l10 10M10 0 0 10" stroke="currentColor" stroke-width="1"/></svg>',
  book: svg('<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/>', 40),
  minus: svg('<path d="M6 12h12"/>', 16),
  plus: svg('<path d="M6 12h12M12 6v12"/>', 16),
  chevronRight: svg('<path d="m9.5 6 6 6-6 6"/>', 16),
  chevronLeft: svg('<path d="m14.5 6-6 6 6 6"/>', 16),
  info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.01"/>', 16),
  github:
    '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>',
  keyboard: svg('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>', 16),
}
