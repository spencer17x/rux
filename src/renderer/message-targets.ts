export type MessageTarget = { kind: "link"; url: string } | { kind: "file"; projectId: string; path: string };

export function messageTargetFromHref(href: string | undefined, projectId?: string): MessageTarget | null {
  const value = href?.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return { kind: "link", url: value };
  if (!projectId || /^(?:#|mailto:|tel:|data:|javascript:)/i.test(value)) return null;
  return { kind: "file", projectId, path: value };
}
