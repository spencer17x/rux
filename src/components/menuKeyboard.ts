import type { KeyboardEvent } from "react";

/** Shared native-menu navigation, leaving text fields and sliders to the browser. */
export function navigateMenu(event: KeyboardEvent<HTMLElement>): void {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-menu-item]:not(:disabled), [role='menuitem']:not(:disabled), [role='menuitemradio']:not(:disabled)"));
  if (!items.length) return;
  const index = items.findIndex((item) => item === event.target || item.contains(event.target as Node));
  let next = -1;
  if (event.key === "ArrowDown") next = (index + 1) % items.length;
  if (event.key === "ArrowUp") next = index <= 0 ? items.length - 1 : index - 1;
  if (event.key === "Home") next = 0;
  if (event.key === "End") next = items.length - 1;
  if (next < 0 && event.key.length === 1 && event.key !== " ") {
    const ordered = [...items.slice(index + 1), ...items.slice(0, index + 1)];
    const match = ordered.find((item) => item.textContent?.trim().toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));
    if (match) next = items.indexOf(match);
  }
  if (next < 0) return;
  event.preventDefault();
  event.stopPropagation();
  items[next].focus();
}
