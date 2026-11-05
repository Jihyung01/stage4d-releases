// Version-independent smoke test of an installed stage4d (0.9 and later), used by
// validate-installers.yml on GitHub-hosted runners. It launches the installed executable
// in a fresh temporary profile and checks the version and window title, that the 3D stage
// and the sample show's script render, that the desktop runtime process answers, and that
// no device output is armed. Nothing is sent to any device and no output is enabled.
import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const executablePath = process.env.STAGE4D_EXECUTABLE;
const expectedVersion = process.env.STAGE4D_EXPECTED_VERSION;
assert.ok(executablePath && expectedVersion, "STAGE4D_EXECUTABLE and STAGE4D_EXPECTED_VERSION are required");
await mkdir("reports", { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), "stage4d-smoke-"));
const passed = [], errors = [];
let app = null, execution = null, failure = null;
try {
  // Hosted runners have no GPU: WebGL runs on Chromium's software rasterizer.
  app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`, "--enable-unsafe-swiftshader"], timeout: 120000 });
  execution = await app.evaluate(({ app: electronApp }) => ({
    version: electronApp.getVersion(), platform: process.platform, architecture: process.arch,
    runningUnderARM64Translation: electronApp.runningUnderARM64Translation ?? false,
  }));
  assert.equal(execution.version, expectedVersion);
  if (process.env.STAGE4D_EXPECTED_ARCH) assert.equal(execution.architecture, process.env.STAGE4D_EXPECTED_ARCH);
  if (process.env.STAGE4D_REQUIRE_NATIVE === "1") assert.equal(execution.runningUnderARM64Translation, false);
  passed.push(`installed stage4d ${execution.version} launches natively (${execution.platform} ${execution.architecture}) in a temporary profile`);
  const page = await app.firstWindow({ timeout: 120000 });
  page.on("pageerror", (error) => errors.push(error.message));
  const title = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle() ?? "");
  assert.ok(title.includes(expectedVersion), `window title '${title}'`);
  passed.push(`window title '${title}'`);
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 90000 });
  await expect(page.locator(".script-panel .script-lines .line-main p").first()).toBeVisible({ timeout: 90000 });
  passed.push("the 3D stage canvas and the sample show's script render");
  const runtime = await page.evaluate(async () => { const answer = await window.stage4d.runtime.connect(); return { status: answer?.snapshot?.status ?? null, mode: answer?.snapshot?.mode ?? null }; });
  assert.ok(runtime.status, "the runtime answers with a snapshot");
  passed.push(`the desktop runtime process answers (status ${runtime.status}, mode ${runtime.mode})`);
  const outputs = await page.evaluate(() => window.stage4d.outputs.invoke("state"));
  assert.deepEqual(outputs.claims.filter((claim) => claim.armed), [], "no output armed");
  passed.push("no device output is armed after launch");
  await page.screenshot({ path: "reports/desktop-smoke.png" });
  assert.deepEqual(errors, []);
  passed.push("no page errors");
} catch (error) { failure = error; }
finally {
  await app?.close().catch(() => {});
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
await writeFile("reports/desktop-smoke.json", JSON.stringify({ success: !failure, version: expectedVersion, execution, passed, errors, failure: failure ? String(failure.stack ?? failure) : null,
  limitations: ["Hosted runner with software rendering; GPU quality, audio and MIDI devices, displays and lighting hardware are not tested", "Direct executable launch does not validate Gatekeeper or SmartScreen approval", "Only launch, render, runtime process and output state are checked; no cue, network or device output is exercised"] }, null, 2));
if (failure) { console.error(failure); process.exit(1); }
console.log(passed.map((line) => `✓ ${line}`).join("\n"));
