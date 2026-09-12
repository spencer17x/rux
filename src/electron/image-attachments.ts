import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { imageImportSchema, imagePreviewSchema, parseInput } from "../shared/ipc";

const maxImageBytes = 10 * 1024 * 1024;
function imageType(data: Buffer): string {
  return data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "png"
    : data[0] === 255 && data[1] === 216 && data[2] === 255 ? "jpeg"
    : /^GIF8[79]a$/.test(data.subarray(0, 6).toString()) ? "gif"
    : data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP" ? "webp" : "";
}

/** Return only bounded raster image data; never expose a general file reader to the renderer. */
export async function previewImageAttachment(input: unknown): Promise<string> {
  const { path } = parseInput(imagePreviewSchema, input);
  if (!isAbsolute(path) || !/\.(png|jpe?g|gif|webp)$/i.test(path)) throw new Error("仅支持本地 PNG、JPEG、GIF 或 WebP 图片预览");
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK).catch(() => { throw new Error("图片文件不存在或无法读取，请重新添加"); });
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error("该附件不是图片文件");
    if (!info.size || info.size > maxImageBytes) throw new Error("单张预览图片不能超过 10 MB");
    const data = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < data.length) {
      const { bytesRead } = await file.read(data, length, data.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== info.size) throw new Error("图片文件已变化，请重试");
    const bytes = data.subarray(0, length);
    const type = imageType(bytes);
    if (!type) throw new Error("图片格式无效，请重新添加");
    return `data:image/${type};base64,${bytes.toString("base64")}`;
  } finally { await file.close(); }
}

export async function importImageAttachment(directory: string, input: unknown): Promise<string> {
  const value = parseInput(imageImportSchema, input);
  const data = Buffer.from(value.base64, "base64");
  if (!data.length || data.length > maxImageBytes) throw new Error("单张图片不能超过 10 MB");
  const type = imageType(data);
  if (!type || value.mimeType !== `image/${type}`) throw new Error("图片格式无效，请使用 PNG、JPEG、GIF 或 WebP");
  const folder = join(directory, randomUUID());
  const stem = value.name.replace(/\.[^.]*$/, "").replace(/[^\p{L}\p{N} _-]/gu, "_").slice(0, 80) || "图片";
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const path = join(folder, `${stem}.${type === "jpeg" ? "jpg" : type}`);
  await writeFile(path, data, { mode: 0o600, flag: "wx" });
  return path;
}
