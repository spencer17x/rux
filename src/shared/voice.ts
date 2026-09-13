export type VoiceStatus = { available: boolean; permission?: string; onDevice?: boolean; message?: string };

export function appendDictation(draft: string, transcript: string): string {
  const text = transcript.trim();
  if (!text) return draft;
  return draft ? `${draft}${/\s$/.test(draft) ? "" : "\n"}${text}` : text;
}

export function encodeWave(chunks: readonly Float32Array[], sampleRate: number): Uint8Array {
  const count = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (!count || count > sampleRate * 61 || sampleRate < 8000 || sampleRate > 48000) throw new Error("录音时长或采样率无效");
  const bytes = new Uint8Array(44 + count * 2), view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i); };
  text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, count * 2, true);
  let offset = 44;
  for (const chunk of chunks) for (const sample of chunk) { const value = Math.max(-1, Math.min(1, sample)); view.setInt16(offset, Math.round(value * (value < 0 ? 32768 : 32767)), true); offset += 2; }
  return bytes;
}
