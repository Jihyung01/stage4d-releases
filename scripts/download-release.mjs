import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";

const release = JSON.parse(await readFile(new URL("../validation-assets.json", import.meta.url), "utf8"));
const filenames = {
  windows: "stage4d-0.3.0-win-x64-setup.exe",
  "macos-intel": "stage4d-0.3.0-mac-x64.dmg",
  "macos-arm64": "stage4d-0.3.0-mac-arm64.dmg",
};
const target = process.argv[2], filename = filenames[target];
if (!filename) throw new Error("Expected windows, macos-intel or macos-arm64");
const artifact = release.artifacts.find(item => item.name === filename);
if (!artifact || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0) throw new Error("Invalid pinned release metadata");
const expectedURL = `https://github.com/Jihyung01/stage4d-releases/releases/download/v0.3.0/${filename}`;
if (artifact.url !== expectedURL) throw new Error("Unexpected release URL");
await mkdir("download", { recursive: true }); await mkdir("reports", { recursive: true });
const destination = path.resolve("download", filename), temporary = `${destination}.partial`;
async function verify(file) {
  if ((await stat(file)).size !== artifact.bytes) throw new Error("Installer size differs from the pinned release");
  const hash = createHash("sha256"); for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest("hex") !== artifact.sha256) throw new Error("Installer SHA-256 differs from the pinned release");
}
try { await verify(destination); }
catch {
  await rm(temporary, { force: true });
  try {
    let url = new URL(expectedURL), response;
    for (let count = 0; count < 6; count++) {
      if (url.protocol !== "https:" || url.username || url.password || !(url.hostname === "github.com" || url.hostname.endsWith(".githubusercontent.com"))) throw new Error("Unexpected release download redirect");
      response = await fetch(url, { redirect: "manual", credentials: "omit", signal: AbortSignal.timeout(180000), headers: { "user-agent": "stage4d-public-release-validation" } });
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get("location"); await response.body?.cancel();
        if (!next) throw new Error("Release download redirect has no destination");
        url = new URL(next, url); continue;
      }
      break;
    }
    if (!response?.ok || !response.body) throw new Error(`Public installer download failed (${response?.status ?? "no response"}). The release must be published.`);
    let received = 0;
    const limit = new Transform({ transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > artifact.bytes) return callback(new Error("Download exceeds the pinned installer size"));
      callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(temporary, { flags: "wx" }));
    await verify(temporary); await rename(temporary, destination);
  } catch (error) { await rm(temporary, { force: true }); throw error; }
}
await writeFile(`reports/download-${target}.json`, JSON.stringify({ version: release.version, artifact: filename, bytes: artifact.bytes, sha256: artifact.sha256, verifiedAt: new Date().toISOString(), source: expectedURL, authenticatedDownload: false }, null, 2));
console.log(`Verified ${filename}: ${artifact.sha256}`);
