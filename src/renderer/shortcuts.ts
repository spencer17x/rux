export type ShortcutId =
  | "settings"
  | "newStandalone"
  | "terminal"
  | "review"
  | "toggleLeftPanel"
  | "files"
  | "remote"
  | "sideChat";

export type ShortcutEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

export type ShortcutDefinition = {
  id: ShortcutId;
  label: string;
  keys: string;
  matches: (event: ShortcutEvent) => boolean;
};

const key = (event: ShortcutEvent) => event.key.toLowerCase();
// Cmd on macOS, Ctrl on Windows/Linux for the "primary" bindings.
const primary = (event: ShortcutEvent) => event.metaKey || event.ctrlKey;

/**
 * Single source of truth for keyboard shortcuts: the window handler and the
 * settings page both read this list, so a rebind only needs one edit.
 */
export const shortcuts: ShortcutDefinition[] = [
  { id: "settings", label: "打开设置", keys: "⌘,", matches: (event) => primary(event) && event.key === "," },
  { id: "newStandalone", label: "新建独立会话", keys: "⌘N", matches: (event) => primary(event) && key(event) === "n" },
  { id: "terminal", label: "打开终端", keys: "⌃`", matches: (event) => event.ctrlKey && event.key === "`" },
  { id: "review", label: "审查变更", keys: "⌃⇧G", matches: (event) => event.ctrlKey && event.shiftKey && key(event) === "g" },
  { id: "toggleLeftPanel", label: "切换左侧面板", keys: "⌘B", matches: (event) => primary(event) && key(event) === "b" },
  { id: "files", label: "打开项目文件", keys: "⌘P", matches: (event) => event.metaKey && key(event) === "p" },
  { id: "remote", label: "打开远程仓库", keys: "⌥⌘R", matches: (event) => event.metaKey && event.altKey && key(event) === "r" },
  { id: "sideChat", label: "打开侧边聊天", keys: "⌥⌘S", matches: (event) => event.metaKey && event.altKey && key(event) === "s" },
];

export function matchShortcut(event: ShortcutEvent): ShortcutDefinition | null {
  return shortcuts.find((shortcut) => shortcut.matches(event)) ?? null;
}
