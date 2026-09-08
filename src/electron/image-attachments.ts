import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { imageImportSchema, parseInput } from "../shared/ipc";

export async function importImageAttachment(directory: string, input: unknown): Promise<string> {
  const value = parseInput(imageImportSchema, input);
  const data = Buffer.from(value.base64, "base64");
  if (!data.length || data.length > 10 * 1024 * 1024) throw new Error("单张图片不能超过 10 MB");
  const type = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "png"
    : data[0] === 255 && data[1] === 216 && data[2] === 255 ? "jpeg"
    : /^GIF8[79]a$/.test(data.subarray(0, 6).toString()) ? "gif"
    : data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP" ? "webp" : "";
  if (!type || value.mimeType !== `image/${type}`) throw new Error("图片格式无效，请使用 PNG、JPEG、GIF 或 WebP");
  const folder = join(directory, randomUUID());
  const stem = value.name.replace(/\.[^.]*$/, "").replace(/[^\p{L}\p{N} _-]/gu, "_").slice(0, 80) || "图片";
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const path = join(folder, `${stem}.${type === "jpeg" ? "jpg" : type}`);
  await writeFile(path, data, { mode: 0o600, flag: "wx" });
  return path;
}
