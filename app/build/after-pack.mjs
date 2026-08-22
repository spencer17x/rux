import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import plist from "plist";

export const UNUSED_PRIVACY_USAGE_KEYS = Object.freeze([
  "NSAudioCaptureUsageDescription",
  "NSBluetoothAlwaysUsageDescription",
  "NSBluetoothPeripheralUsageDescription",
  "NSCameraUsageDescription",
]);

export const MICROPHONE_USAGE_DESCRIPTION = "Rux uses the microphone only when you choose Voice input in the Composer.";

export function hardenMacInfoPlist(info) {
  // electron-builder 26 injects NSAllowsArbitraryLoads for its optional updater
  // localhost proxy. RUX does not use that renderer/network path, so remove the
  // complete exception dictionary and fall back to the secure ATS defaults.
  delete info.NSAppTransportSecurity;

  for (const key of UNUSED_PRIVACY_USAGE_KEYS) {
    delete info[key];
  }
  info.NSMicrophoneUsageDescription = MICROPHONE_USAGE_DESCRIPTION;

  return info;
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const infoPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    "Contents",
    "Info.plist",
  );
  const info = plist.parse(await readFile(infoPath, "utf8"));
  await writeFile(infoPath, plist.build(hardenMacInfoPlist(info)), "utf8");
}
