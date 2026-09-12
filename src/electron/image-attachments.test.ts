import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { importImageAttachment, previewImageAttachment } from "./image-attachments";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
describe("image attachment import", () => {
  it("stores independent images inside the managed directory, not a supplied path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rux-images-"));
    try {
      const input = { name: "../../image.png", mimeType: "image/png", base64: png };
      const first = await importImageAttachment(directory, input);
      const second = await importImageAttachment(directory, input);
      expect(relative(directory, first).startsWith("..")).toBe(false);
      expect(first).not.toBe(second);
      expect(await readFile(first)).toEqual(Buffer.from(png, "base64"));
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("rejects invalid, mismatched and oversized images", async () => {
    await expect(importImageAttachment("unused", { name: "a.svg", mimeType: "image/svg+xml", base64: png })).rejects.toThrow();
    await expect(importImageAttachment("unused", { name: "a.jpg", mimeType: "image/jpeg", base64: png })).rejects.toThrow("图片格式无效");
    await expect(importImageAttachment("unused", { name: "a.png", mimeType: "image/png", base64: "not valid" })).rejects.toThrow();
    await expect(importImageAttachment("unused", { name: "a.png", mimeType: "image/png", base64: "A".repeat(13_981_020) })).rejects.toThrow();
  });

  it("previews both managed and file-picker images as typed raster data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rux-preview-"));
    try {
      const managed = await importImageAttachment(directory, { name: "粘贴.png", mimeType: "image/png", base64: png });
      const picked = join(directory, "选择文件.PNG");
      await writeFile(picked, Buffer.from(png, "base64"));
      for (const path of [managed, picked]) expect(await previewImageAttachment({ path })).toBe(`data:image/png;base64,${png}`);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("rejects remote paths, non-images, missing files, directories and oversized previews", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rux-preview-"));
    try {
      await expect(previewImageAttachment({ path: "https://example.com/a.png" })).rejects.toThrow("仅支持本地");
      await expect(previewImageAttachment({ path: "relative.png" })).rejects.toThrow("仅支持本地");
      await expect(previewImageAttachment({ path: `${directory}/a.png\0` })).rejects.toThrow();
      await expect(previewImageAttachment({ path: join(directory, "secret.txt") })).rejects.toThrow("仅支持本地");
      await expect(previewImageAttachment({ path: join(directory, "missing.png") })).rejects.toThrow("不存在或无法读取");
      const fake = join(directory, "fake.png");
      await writeFile(fake, "private text is not an image");
      await expect(previewImageAttachment({ path: fake })).rejects.toThrow("图片格式无效");
      const folder = join(directory, "folder.png");
      await mkdir(folder);
      await expect(previewImageAttachment({ path: folder })).rejects.toThrow("不是图片文件");
      await writeFile(fake, Buffer.alloc(10 * 1024 * 1024 + 1));
      await expect(previewImageAttachment({ path: fake })).rejects.toThrow("不能超过 10 MB");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
