import { useCallback, useEffect, useRef, useState } from "react";
import type { RuxApi } from "../../electron/preload";
import { encodeWave } from "../../shared/voice";
import { userFacingError } from "../errors";
import captureWorkletUrl from "../../audio/capture.worklet.js?url&no-inline";

type Recording = { stream: MediaStream; context: AudioContext; source?: MediaStreamAudioSourceNode; node?: AudioWorkletNode; chunks: Float32Array[]; timer?: ReturnType<typeof setTimeout> };
export function useVoiceInput(api: RuxApi, draftKey: string, onTranscript: (text: string) => void, notify: (message: string) => void) {
  const [available, setAvailable] = useState(false);
  const [phase, setPhase] = useState<"idle" | "preparing" | "recording" | "transcribing">("idle");
  const [seconds, setSeconds] = useState(0);
  const generation = useRef(0), recording = useRef<Recording | null>(null), operation = useRef<string | null>(null);
  const active = useRef(false);
  const transcript = useRef(onTranscript), notice = useRef(notify); transcript.current = onTranscript; notice.current = notify;
  const release = useCallback(() => { const current = recording.current; recording.current = null; if (current) { clearTimeout(current.timer); if (current.node) current.node.port.onmessage = null; current.node?.disconnect(); current.source?.disconnect(); current.stream.getTracks().forEach(track => track.stop()); void current.context.close().catch(() => {}); } return current; }, []);
  const cancel = useCallback(() => { active.current = false; generation.current++; release(); const id = operation.current; operation.current = null; if (id) void api.voice.cancel({ id }).catch(() => {}); setPhase("idle"); }, [api, release]);
  useEffect(() => { let active = true; api.voice?.status().then(status => { if (active) setAvailable(status.available); }).catch(() => {}); return () => { active = false; }; }, [api]);
  useEffect(() => { cancel(); return cancel; }, [draftKey, cancel]);
  useEffect(() => { if (phase !== "recording") return; const timer = setInterval(() => setSeconds(value => value + 1), 1000); return () => clearInterval(timer); }, [phase]);

  const stop = useCallback(async () => {
    const current = release(); if (!current) return;
    const token = generation.current, id = crypto.randomUUID(); operation.current = id; setPhase("transcribing");
    try {
      const bytes = encodeWave(current.chunks, current.context.sampleRate);
      const blocks: string[] = [];
      for (let offset = 0; offset < bytes.length; offset += 8192) blocks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
      current.chunks.length = 0;
      const result = await api.voice.transcribe({ id, base64: btoa(blocks.join("")) });
      if (generation.current === token) { if (result.text?.trim()) transcript.current(result.text); else notice.current("没有识别到语音，请重试"); }
    } catch (error) { if (generation.current === token) notice.current(userFacingError(error)); }
    finally { if (generation.current === token) { active.current = false; operation.current = null; setPhase("idle"); } }
  }, [api, release]);
  const start = useCallback(async () => {
    if (active.current) return; active.current = true;
    const token = ++generation.current; setPhase("preparing"); setSeconds(0);
    let stream: MediaStream | undefined;
    try {
      const id = crypto.randomUUID(); operation.current = id;
      await api.voice.prepare({ id }); if (generation.current !== token) return; operation.current = null;
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      if (generation.current !== token) { stream.getTracks().forEach(track => track.stop()); return; }
      const context = new AudioContext({ sampleRate: 16000 });
      const current: Recording = { stream, context, chunks: [] }; recording.current = current;
      await context.audioWorklet.addModule(captureWorkletUrl);
      if (generation.current !== token) return;
      current.node = new AudioWorkletNode(context, "rux-capture"); current.source = context.createMediaStreamSource(stream);
      current.node.port.onmessage = (event: MessageEvent<Float32Array>) => { if (generation.current === token) current.chunks.push(event.data); };
      current.source.connect(current.node); current.node.connect(context.destination); await context.resume();
      if (generation.current !== token) return;
      setPhase("recording"); current.timer = setTimeout(() => void stop(), 60_000);
    } catch (error) { stream?.getTracks().forEach(track => track.stop()); if (generation.current === token) { active.current = false; operation.current = null; release(); setPhase("idle"); notice.current(error instanceof DOMException && error.name === "NotAllowedError" ? "麦克风权限未开启，请在系统设置中允许 Rux" : userFacingError(error)); } }
  }, [api, release, stop]);
  return { available, phase, seconds, cancel, toggle: () => { if (phase === "idle") void start(); else if (phase === "recording") void stop(); else cancel(); } };
}
