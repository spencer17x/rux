import { cpSync, existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function ruxDataRoot(electronUserData: string, argv = process.argv, home = homedir()): string {
  // Electron's explicit data directory is used by isolated test and portable runs.
  if (argv.some((arg) => arg.startsWith("--user-data-dir="))) return electronUserData;
  return join(home, ".rux");
}

export function migrateRuxDataRoot(previous: string, next: string): void {
  if (resolve(previous) === resolve(next)) return;
  mkdirSync(next, { recursive: true, mode: 0o700 });
  const marker = join(next, ".legacy-user-data-imported");
  if (existsSync(marker) || !existsSync(previous)) return;
  // Keep the old directory intact. Existing files in ~/.rux always take precedence.
  cpSync(previous, next, {
    recursive: true,
    force: false,
    errorOnExist: false,
    preserveTimestamps: true,
    filter: (source) => !lstatSync(source).isSymbolicLink(),
  });
  writeFileSync(marker, `${previous}\n`, { mode: 0o600 });
}
