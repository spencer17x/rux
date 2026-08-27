import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

function normalizeMessagePath(value: string): string {
  let path = value.trim();
  if (path.startsWith("file://")) path = fileURLToPath(path);
  else {
    path = path.split("#", 1)[0].split("?", 1)[0];
    try { path = decodeURIComponent(path); } catch {}
  }
  return path.replace(/:(\d+)(?::\d+)?$/, "");
}

export async function resolveProjectMessageFile(projectPath: string, requestedPath: string): Promise<string> {
  const root = await realpath(projectPath);
  const requested = normalizeMessagePath(requestedPath);
  const file = await realpath(isAbsolute(requested) ? requested : resolve(root, requested));
  const fromRoot = relative(root, file);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) throw new Error("只能操作当前项目内的文件");
  if (!(await stat(file)).isFile()) throw new Error("消息目标不是文件");
  return file;
}
