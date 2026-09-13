// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useVoiceInput } from "./useVoiceInput";
import type { RuxApi } from "../../electron/preload";

let node: { port: { onmessage: ((event: { data: Float32Array }) => void) | null } };
const stopTrack = vi.fn();
class TestContext { sampleRate = 16000; destination = {}; audioWorklet = { addModule: vi.fn(async () => {}) }; createMediaStreamSource() { return { connect: vi.fn(), disconnect: vi.fn() }; } resume = vi.fn(async () => {}); close = vi.fn(async () => {}); }
class TestWorklet { port = { onmessage: null as ((event: { data: Float32Array }) => void) | null }; connect = vi.fn(); disconnect = vi.fn(); constructor() { node = this; } }
let root: ReturnType<typeof createRoot>, element: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("AudioContext", TestContext); vi.stubGlobal("AudioWorkletNode", TestWorklet); vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) } }); stopTrack.mockClear(); element = document.createElement("div"); document.body.append(element); root = createRoot(element); });
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.unstubAllGlobals(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
async function setup() {
  const result = deferred<{ text: string }>();
  const api = { voice: { status: vi.fn(async () => ({ available: true })), prepare: vi.fn(async () => {}), transcribe: vi.fn(() => result.promise), cancel: vi.fn(async () => {}) } };
  const insert = vi.fn(), notify = vi.fn(); let voice!: ReturnType<typeof useVoiceInput>;
  function Demo({ draft }: { draft: string }) { voice = useVoiceInput(api as unknown as RuxApi, draft, insert, notify); return null; }
  const render = async (draft: string) => { await act(async () => root.render(<Demo draft={draft} />)); };
  await render("first");
  return { api, insert, notify, result, render, get voice() { return voice; } };
}
it("records WAV, stops microphone tracks, then inserts the transcription exactly once", async () => {
  const test = await setup();
  await act(async () => test.voice.toggle()); expect(test.voice.phase).toBe("recording");
  node.port.onmessage!({ data: new Float32Array([0, .25, -.25]) });
  await act(async () => test.voice.toggle()); expect(test.voice.phase).toBe("transcribing"); expect(stopTrack).toHaveBeenCalled();
  const input = test.api.voice.transcribe.mock.calls[0] as unknown as [{ base64: string }]; expect(atob(input[0].base64).slice(0, 4)).toBe("RIFF");
  await act(async () => test.result.resolve({ text: "语音内容" }));
  expect(test.insert).toHaveBeenCalledExactlyOnceWith("语音内容"); expect(test.voice.phase).toBe("idle");
});
it("cancels transcription after a conversation switch and ignores late results", async () => {
  const test = await setup(); await act(async () => test.voice.toggle()); node.port.onmessage!({ data: new Float32Array([0, .1]) });
  await act(async () => test.voice.toggle()); await test.render("second");
  expect(test.api.voice.cancel).toHaveBeenCalledOnce();
  await act(async () => test.result.resolve({ text: "不能写入新会话" })); expect(test.insert).not.toHaveBeenCalled(); expect(test.voice.phase).toBe("idle");
});
it("preserves the draft on permission refusal and can retry", async () => {
  const test = await setup(); test.api.voice.prepare.mockRejectedValueOnce(new Error("麦克风权限未开启"));
  await act(async () => test.voice.toggle()); expect(test.voice.phase).toBe("idle"); expect(test.notify).toHaveBeenCalledWith("麦克风权限未开启"); expect(test.insert).not.toHaveBeenCalled();
  await act(async () => test.voice.toggle()); expect(test.voice.phase).toBe("recording"); await act(async () => test.voice.cancel()); expect(stopTrack).toHaveBeenCalled();
});
