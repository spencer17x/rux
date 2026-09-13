// Manual acceptance check. Uses synthesized speech, never opens the microphone.
// macOS may ask the user to authorize Rux speech recognition.
import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
const folder = mkdtempSync(join(tmpdir(), 'rux-voice-acceptance-'));
let application;
try {
  execFileSync('/usr/bin/say', ['-v', 'Eddy (中文（中国大陆）)', '-o', join(folder, 'speech.aiff'), '这是一个语音功能测试。请保留原来的文字。']);
  execFileSync('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', join(folder, 'speech.aiff'), join(folder, 'speech.wav')]);
  // Normalize to the application's mono PCM WAV format; afconvert adds metadata chunks.
  const raw = readFileSync(join(folder, 'speech.wav'));
  let offset = 12, pcm;
  while (offset + 8 <= raw.length) { const length = raw.readUInt32LE(offset + 4); if (raw.toString('ascii', offset, offset + 4) === 'data') { pcm = raw.subarray(offset + 8, offset + 8 + length); break; } offset += 8 + length + (length % 2); }
  if (!pcm) throw new Error('Missing generated PCM');
  const wave = Buffer.alloc(44 + pcm.length); wave.write('RIFF'); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8); wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22); wave.writeUInt32LE(16000, 24); wave.writeUInt32LE(32000, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(pcm.length, 40); pcm.copy(wave, 44);
  application = await electron.launch({ executablePath: resolve('release/mac-arm64/Rux.app/Contents/MacOS/Rux'), args: [`--user-data-dir=${join(folder, 'profile')}`], env: { ...process.env, RUX_E2E: '1' } });
  const page = await application.firstWindow(); await page.waitForLoadState('domcontentloaded');
  const result = await page.evaluate(input => window.rux.voice.transcribe(input), { id: randomUUID(), base64: wave.toString('base64') });
  console.log(JSON.stringify(result));
  if (!result.text.includes('测试') || !result.text.includes('文字')) throw new Error('Transcription did not match the generated test speech');
} finally {
  await application?.close(); rmSync(folder, { recursive: true, force: true });
}
