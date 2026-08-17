import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const output = resolve("out/update-config.json");
const raw = process.env.RUX_UPDATE_FEED_URL?.trim();
let feedUrl;
if (raw) {
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("RUX_UPDATE_FEED_URL must be a credential-free HTTPS base URL without query or fragment");
  }
  feedUrl = parsed.toString().replace(/\/$/, "");
}
mkdirSync(resolve("out"), { recursive: true });
writeFileSync(output, `${JSON.stringify({ version: 1, enabled: Boolean(feedUrl), ...(feedUrl ? { feedUrl } : {}), channel: process.env.RUX_UPDATE_CHANNEL || "stable" }, null, 2)}\n`, "utf8");
console.log(`Prepared ${output} (${feedUrl ? "signed update feed configured" : "updates disabled"})`);
