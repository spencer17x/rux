import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { importImageAttachment } from "./image-attachments";

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
});
