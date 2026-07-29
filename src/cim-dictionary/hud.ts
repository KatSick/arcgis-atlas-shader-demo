export interface CimHudInfo {
  units: number;
  atlasEntries: number;
  /** multipoint tactical graphics (mil-sym-ts pipeline), when the demo shows them */
  tacticalFull?: number;
  tacticalSimplified?: number;
  tacticalTotal?: number;
}

/** Tiny stats overlay for the CIM dictionary demos: fps, units, atlas usage. */
export function createCimHud(engineName: string): {
  frame(nowMs: number): void;
  set(info: CimHudInfo): void;
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
  let info: CimHudInfo = { units: 0, atlasEntries: 0 };

  const redraw = () => {
    let text =
      `${engineName} · CIM dictionary renderer (stylx → Canvas → atlas)\n` +
      `fps ${fps.toFixed(0).padStart(3)} · units ${info.units} · atlas ${info.atlasEntries}`;
    if (info.tacticalTotal !== undefined) {
      text +=
        `\nmultipoint ${info.tacticalTotal}: ${info.tacticalFull ?? 0} full + ` +
        `${info.tacticalSimplified ?? 0} simplified in view`;
    }
    el.textContent = text;
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
