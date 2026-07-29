/** Tiny stats overlay for the CIM dictionary demos: fps, units, atlas usage. */
export function createCimHud(engineName: string): {
  frame(nowMs: number): void;
  set(info: { units: number; atlasEntries: number }): void;
} {
  const el = document.createElement("div");
  el.style.cssText = [
    "position:fixed",
    "top:8px",
    "left:8px",
    "z-index:1000",
    "background:rgba(0,0,0,0.72)",
    "color:#9be89b",
    "font:12px/1.5 monospace",
    "padding:8px 10px",
    "border-radius:4px",
    "pointer-events:none",
    "white-space:pre",
  ].join(";");
  document.body.appendChild(el);

  let frames = 0;
  let windowStart = 0;
  let fps = 0;
  let info = { units: 0, atlasEntries: 0 };

  const redraw = () => {
    el.textContent =
      `${engineName} · CIM dictionary renderer (stylx → Canvas → atlas)\n` +
      `fps ${fps.toFixed(0).padStart(3)} · units ${info.units} · atlas ${info.atlasEntries}`;
  };

  return {
    frame(nowMs: number) {
      frames++;
      if (windowStart === 0) windowStart = nowMs;
      const elapsed = nowMs - windowStart;
      if (elapsed >= 500) {
        fps = (frames * 1000) / elapsed;
        frames = 0;
        windowStart = nowMs;
        redraw();
      }
    },
    set(next) {
      info = next;
      redraw();
    },
  };
}
