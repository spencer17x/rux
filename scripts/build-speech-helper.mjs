import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

if (process.platform === 'darwin') {
  const source = resolve('native/speech/main.swift'), plist = resolve('native/speech/Info.plist');
  const output = resolve('out/native/rux-speech'), stamp = `${output}.sha256`;
  const hash = createHash('sha256').update(readFileSync(source)).update(readFileSync(plist)).update(process.arch).digest('hex');
  if (!existsSync(output) || !existsSync(stamp) || readFileSync(stamp, 'utf8') !== hash) {
    mkdirSync(resolve('out/native'), { recursive: true });
    execFileSync('xcrun', ['swiftc', '-swift-version', '5', '-O', '-framework', 'Speech', '-framework', 'Foundation', source, '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', plist, '-o', output], { stdio: 'inherit' });
    writeFileSync(stamp, hash);
  }
}
