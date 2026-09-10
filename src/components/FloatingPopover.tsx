import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

type Props = { anchorRef: RefObject<HTMLElement | null>; scope: string; align?: "start" | "end"; children: ReactNode };

/** Portal menus out of the scroll/composer surface, then fit them to the window. */
export default function FloatingPopover({ anchorRef, scope, align = "end", children }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 0, ready: false });
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const layer = layerRef.current;
    if (!anchor || !layer) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = anchor.getBoundingClientRect();
      const menu = layer.getBoundingClientRect();
      const margin = 8;
      const gap = 6;
      const above = rect.top - margin - gap;
      const below = window.innerHeight - rect.bottom - margin - gap;
      const useTop = above >= menu.height || above >= below;
      const maxHeight = Math.max(64, Math.min(window.innerHeight - margin * 2, useTop ? above : below));
      const height = Math.min(menu.height, maxHeight);
      const left = Math.max(margin, Math.min(align === "end" ? rect.right - menu.width : rect.left, window.innerWidth - menu.width - margin));
      const top = Math.max(margin, Math.min(useTop ? rect.top - height - gap : rect.bottom + gap, window.innerHeight - height - margin));
      setPosition((current) => current.left === left && current.top === top && current.maxHeight === maxHeight && current.ready ? current : { left, top, maxHeight, ready: true });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    // ResizeObserver runs before paint: reposition in the same frame when a
    // model list is replaced by the taller power controls.
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    observer.observe(layer);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    update();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [align, anchorRef]);
  useLayoutEffect(() => {
    if (!position.ready || focused.current) return;
    focused.current = true;
    const target = layerRef.current?.querySelector<HTMLElement>("[data-autofocus], [aria-checked='true'], [aria-pressed='true']")
      || layerRef.current?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), [tabindex='0']");
    target?.focus({ preventScroll: true });
  }, [position.ready]);

  return createPortal(<div ref={layerRef} className="floating-popover" data-overlay-scope data-overlay-id={scope} style={{ left: position.left, top: position.top, maxHeight: position.ready ? position.maxHeight : "calc(100vh - 16px)", visibility: position.ready ? "visible" : "hidden" }}>{children}</div>, document.body);
}
