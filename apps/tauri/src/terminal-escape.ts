/** Only a real, non-repeated Escape in an owned Tauri terminal can request the canvas. */
export function installCanvasEscape(openCanvas: () => void): () => void {
  const keydown = (event: KeyboardEvent) => {
    const menu = document.getElementById('pane-menu');
    if (
      !event.isTrusted ||
      event.key !== 'Escape' ||
      event.repeat ||
      !document.getElementById('canvas') ||
      (menu instanceof HTMLDetailsElement && menu.open)
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // This local event only revokes input; it cannot invoke a native operation.
    window.dispatchEvent(new Event('orqst-canvas-escape'));
    openCanvas();
  };
  document.addEventListener('keydown', keydown, true);
  return () => document.removeEventListener('keydown', keydown, true);
}
