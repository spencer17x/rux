import { chmod, copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const executable = process.platform === "win32" ? "rux-tui.exe" : "rux-tui";
const source = resolve("../tui/target/release", executable);
const destinationDirectory = resolve("out/bin");
const destination = resolve(destinationDirectory, executable);
await mkdir(destinationDirectory, { recursive: true });
await copyFile(source, destination);
if (process.platform !== "win32") await chmod(destination, 0o755);
console.log(`Prepared ${destination}`);
