import { expect, it, vi } from "vitest";
import { appendDictation, encodeWave } from "./voice";
import { validateWave } from "../electron/voice-service";
vi.mock("electron", () => ({ app: {}, systemPreferences: {} }));

it("appends dictation without overwriting the existing draft", () => {
  expect(appendDictation("已有文字", "  语音内容 ")).toBe("已有文字\n语音内容");
  expect(appendDictation("用户新改的草稿\n", "语音")).toBe("用户新改的草稿\n语音");
  expect(appendDictation("保留", " ")).toBe("保留");
});
it("encodes microphone PCM as bounded mono WAV and rejects tampered headers", () => {
  const wav = encodeWave([new Float32Array([-1, 0, 1])], 16000);
  expect(() => validateWave(Buffer.from(wav))).not.toThrow();
  const samples = new DataView(wav.buffer); expect(samples.getInt16(44, true)).toBe(-32768); expect(samples.getInt16(48, true)).toBe(32767);
  wav[22] = 2; expect(() => validateWave(Buffer.from(wav))).toThrow("录音格式无效");
  expect(() => encodeWave([new Float32Array(16000 * 62)], 16000)).toThrow();
});
