import { useEffect, useRef, type PointerEvent } from "react";

export const SIDEBAR_DEFAULT_WIDTH = 275;
export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_MAX_WIDTH = 520;
export const SIDEBAR_WIDTH_KEY = "rux.sidebar.width.v1";

export function readSidebarWidth(): number {
  try {
    const value = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(value) && value >= SIDEBAR_MIN_WIDTH && value <= SIDEBAR_MAX_WIDTH ? value : SIDEBAR_DEFAULT_WIDTH;
  } catch { return SIDEBAR_DEFAULT_WIDTH; }
}

type Props = { width: number; maximum: number; onChange: (value: number) => void; onCommit: (value: number) => void };

export default function SidebarResizeHandle({ width, maximum, onChange, onCommit }: Props) {
  const drag = useRef<{ x: number; width: number; value: number; cursor: string; userSelect: string } | null>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const clamp = (value: number) => Math.max(SIDEBAR_MIN_WIDTH, Math.min(maximum, Math.round(value)));
  const restore = () => {
    if (!drag.current) return;
    document.body.style.cursor = drag.current.cursor;
    document.body.style.userSelect = drag.current.userSelect;
    drag.current = null;
  };
  useEffect(() => restore, []);
  const finish = (event: PointerEvent<HTMLDivElement>, cancel = false) => {
    if (!drag.current) return;
    const value = clamp(cancel ? drag.current.width : drag.current.value);
    restore();
    onChange(value);
    if (!cancel) onCommit(value);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div ref={handleRef} className="sidebar-resize-handle" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" aria-valuemin={SIDEBAR_MIN_WIDTH} aria-valuemax={maximum} aria-valuenow={width} aria-valuetext={`${width} 像素`} tabIndex={0}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, width, value: width, cursor: document.body.style.cursor, userSelect: document.body.style.userSelect };
      document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
    }}
    onPointerMove={(event) => {
      if (!drag.current) return;
      drag.current.value = clamp(drag.current.width + event.clientX - drag.current.x);
      onChange(drag.current.value);
    }}
    onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)}
    onLostPointerCapture={() => { if (drag.current) { const initial = drag.current.width; restore(); onChange(initial); } }}
    onDoubleClick={() => { const value = clamp(SIDEBAR_DEFAULT_WIDTH); onChange(value); onCommit(value); }}
    onKeyDown={(event) => {
      if (event.key === "Escape" && drag.current) { event.preventDefault(); const initial = drag.current.width; restore(); onChange(initial); return; }
      const step = event.shiftKey ? 1 : 10;
      const next = event.key === "ArrowLeft" ? width - step : event.key === "ArrowRight" ? width + step : event.key === "Home" ? SIDEBAR_MIN_WIDTH : event.key === "End" ? maximum : null;
      if (next === null) return;
      event.preventDefault(); event.stopPropagation();
      const value = clamp(next); onChange(value); onCommit(value);
    }}
  />;
}
