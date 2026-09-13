import { open } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";
import { constants } from "node:fs";
import { isImagePath } from "../shared/model-capabilities";
import { previewImageAttachment } from "./image-attachments";

const fileMimeTypes: Record<string, string> = { ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
export async function responseAttachment(path: string, options: { images: boolean; documents: boolean }): Promise<Record<string, string>> {
  if (!isAbsolute(path) || path.includes("\0")) throw new Error("附件路径无效");
  if (isImagePath(path)) {
    if (!options.images) throw new Error("当前自定义模型未启用图片输入，请在设置中确认模型能力");
    return { type: "input_image", image_url: await previewImageAttachment({ path }) };
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK).catch(() => { throw new Error(`无法读取附件 ${basename(path)}，请重新添加`); });
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 10 * 1024 * 1024) throw new Error(`附件 ${basename(path)} 必须是 10 MB 以内的文件`);
    const data = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < data.length) { const result = await file.read(data, length, data.length - length, length); if (!result.bytesRead) break; length += result.bytesRead; }
    if (length !== info.size) throw new Error(`附件 ${basename(path)} 已变化，请重试`);
    const bytes = data.subarray(0, length), mime = fileMimeTypes[extname(path).toLowerCase()];
    if (mime) {
      if (!options.documents) throw new Error("当前服务未启用文档输入，请在模型设置中确认服务支持 PDF / Office 文件");
      if (mime === "application/pdf" && !options.images) throw new Error("PDF 文件需要支持图片输入的模型");
      return { type: "input_file", filename: basename(path), file_data: `data:${mime};base64,${bytes.toString("base64")}` };
    }
    if (bytes.length > 512_000) throw new Error(`文本附件 ${basename(path)} 超过 500 KB，请缩小内容后添加`);
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); if (text.includes("\0")) throw new Error(); } catch { throw new Error(`不支持附件 ${basename(path)} 的格式，请使用 UTF-8 文本或已启用的文档格式`); }
    return { type: "input_text", text: `上下文文件 ${basename(path)}：\n${text}` };
  } finally { await file.close(); }
}
