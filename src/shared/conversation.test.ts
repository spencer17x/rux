import { expect, it } from "vitest";
import { apiConversation } from "./conversation";
import { assertImageCapability, imageCapability } from "./model-capabilities";

it("keeps the selected conversation's text and attachments without hidden reasoning or failed turns", () => {
  expect(apiConversation([
    { role: "user", text: "看图", attachments: ["/a.png"] },
    { role: "assistant", status: "complete", parts: [{ type: "reasoning", text: "private" }, { type: "text", text: "答复" }] },
    { role: "user", text: "失败图片", attachments: ["/broken.png"] }, { role: "assistant", status: "error", text: "error" },
  ])).toEqual([{ role: "user", text: "看图", attachments: ["/a.png"] }, { role: "assistant", text: "答复" }]);
});
it("fails closed for image-incapable and unknown models while allowing text attachments", () => {
  expect(imageCapability({ inputModalities: ["text", "image"] })).toBe("supported");
  expect(() => assertImageCapability(["/a.png"], imageCapability({ inputModalities: ["text"] }))).toThrow("不支持图片");
  expect(() => assertImageCapability(["/a.png"], imageCapability())).toThrow("尚未确认");
  expect(() => assertImageCapability(["/code.ts"], "unsupported")).not.toThrow();
});
