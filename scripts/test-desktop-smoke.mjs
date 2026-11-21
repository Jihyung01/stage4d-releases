// Version-independent smoke test of an installed stage4d (0.9 and later), used by
// validate-installers.yml on GitHub-hosted runners. It launches the installed executable
// in a fresh temporary profile and checks the version, that the 3D stage and the sample
// show's script render, that the desktop runtime process answers, and that no device output
// is armed. Nothing is sent to any device and no output is enabled.
//
// Since 0.9.0-beta.6 the packaged app has Electron fuses set (Node inspector arguments are
// ignored), so Playwright's electron.launch cannot attach. The test therefore starts the
// installed executable itself with Chromium's --remote-debugging-port=0 (not covered by the
// fuses), reads the port from the profile's DevToolsActivePort file and drives the window over
// the Chrome DevTools Protocol. The same route works for the earlier, unfused 0.9 releases.
// Version and architecture come from the renderer's user agent and the executable's header.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const executablePath = process.env.STAGE4D_EXECUTABLE;
const expectedVersion = process.env.STAGE4D_EXPECTED_VERSION;
assert.ok(executablePath && expectedVersion, "STAGE4D_EXECUTABLE and STAGE4D_EXPECTED_VERSION are required");
await mkdir("reports", { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), "stage4d-smoke-"));
const passed = [], errors = [], notes = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let webgl = null, execution = null, failure = null, child = null, browser = null, exited = null;

// Architecture of the executable from its own header (PE machine or Mach-O CPU type).
async function executableArchitectures(file) {
  const handle = await open(file, "r");
  try {
    const head = Buffer.alloc(4096);
    await handle.read(head, 0, head.length, 0);
    if (head.readUInt16LE(0) === 0x5a4d) {
      const pe = head.readUInt32LE(0x3c), buffer = Buffer.alloc(6);
      await handle.read(buffer, 0, 6, pe);
      assert.equal(buffer.readUInt32LE(0), 0x00004550, "PE signature");
      return [{ 0x8664: "x64", 0xaa64: "arm64", 0x14c: "ia32" }[buffer.readUInt16LE(4)] ?? "unknown"];
    }
    const cpu = (type) => ({ 0x01000007: "x64", 0x0100000c: "arm64" })[type] ?? "unknown";
    if (head.readUInt32BE(0) === 0xcafebabe) {
      return Array.from({ length: head.readUInt32BE(4) }, (_, i) => cpu(head.readUInt32BE(8 + i * 20)));
    }
    if (head.readUInt32LE(0) === 0xfeedfacf) return [cpu(head.readUInt32LE(4))];
    return ["unknown"];
  } finally { await handle.close(); }
}

async function waitForDevToolsPort() {
  const file = path.join(profile, "DevToolsActivePort");
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`The application exited before opening its window (${exited})`);
    const text = await readFile(file, "utf8").catch(() => "");
    const port = Number.parseInt(text.split(/\r?\n/)[0], 10);
    if (Number.isInteger(port) && port > 0) return port;
    await sleep(250);
  }
  throw new Error("The application did not open its DevTools port within 120 s");
}

async function stopApplication() {
  if (!child || exited) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else { try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); } }
  for (let i = 0; i < 40 && !exited; i++) await sleep(250);
  if (!exited) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
    for (let i = 0; i < 40 && !exited; i++) await sleep(250);
  }
  // Helper processes (GPU, renderer, runtime and media engines) leave with the main process.
  await sleep(3000);
}

try {
  const architectures = await executableArchitectures(executablePath);
  // Hosted runners have no GPU: WebGL runs on Chromium's software rasterizer.
  const args = [`--user-data-dir=${profile}`, "--enable-unsafe-swiftshader", "--remote-debugging-port=0"];
  if (process.platform === "darwin") args.push("--use-mock-keychain");
  child = spawn(executablePath, args, { stdio: "ignore", detached: process.platform !== "win32" });
  child.on("exit", (code, signal) => { exited = `exit ${code ?? signal}`; });
  child.on("error", (error) => { exited = `spawn error ${error.message}`; });
  const port = await waitForDevToolsPort();
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 120000 });
  const context = browser.contexts()[0];
  let page = null;
  for (const deadline = Date.now() + 120000; !page && Date.now() < deadline; await sleep(250)) {
    page = context.pages().find((candidate) => !candidate.url().startsWith("devtools://")) ?? null;
  }
  assert.ok(page, "the application window opened");
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForLoadState("domcontentloaded");
  const renderer = await page.evaluate(() => ({ userAgent: navigator.userAgent, platform: window.stage4d?.platform ?? null }));
  execution = { userAgent: renderer.userAgent, platform: renderer.platform, executableArchitectures: architectures };
  assert.ok(renderer.userAgent.includes(`/${expectedVersion} `), `user agent '${renderer.userAgent}' names ${expectedVersion}`);
  assert.equal(renderer.platform, process.platform);
  if (process.env.STAGE4D_EXPECTED_ARCH) assert.deepEqual(architectures, [process.env.STAGE4D_EXPECTED_ARCH], "executable architecture");
  if (process.env.STAGE4D_REQUIRE_NATIVE === "1") {
    const host = process.arch;
    assert.equal(host, architectures[0], "the runner's own architecture matches the executable (no translation)");
  }
  passed.push(`installed stage4d ${expectedVersion} starts in a temporary profile (${renderer.platform}, executable ${architectures.join("+")}, runner ${process.arch})`);
  await expect(page.locator(".script-panel .script-lines .line-main p").first()).toBeVisible({ timeout: 90000 });
  passed.push("the workspace and the sample show's script render");
  // The 3D stage either starts (its WebGL canvas) or the app shows its own '3D 뷰를 시작할 수 없습니다' notice.
  const stage = page.locator(".stage-viewport canvas").first(), failed = page.getByText("3D 뷰를 시작할 수 없습니다");
  await expect.poll(async () => (await failed.count()) > 0 || (await stage.isVisible().catch(() => false)), { timeout: 90000 }).toBe(true);
  await page.waitForTimeout(2000);
  webgl = (await failed.count()) > 0 ? "failed" : "started";
  if (webgl === "started") passed.push("the 3D stage view started (WebGL)");
  else if (process.env.STAGE4D_REQUIRE_WEBGL === "1") throw new Error("The 3D stage view did not start (WebGL)");
  else notes.push("The 3D stage view did not start on this runner: the app showed '3D 뷰를 시작할 수 없습니다' (WebGL unavailable). Not a pass.");
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
  await browser?.close().catch(() => {});
  await stopApplication().catch(() => {});
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {});
}
await writeFile("reports/desktop-smoke.json", JSON.stringify({ success: !failure, version: expectedVersion, driver: "cdp", execution, webgl, passed, notes, errors, failure: failure ? String(failure.stack ?? failure) : null,
  limitations: ["Hosted runner with software rendering; GPU quality, audio and MIDI devices, displays and lighting hardware are not tested", "Direct executable launch does not validate Gatekeeper or SmartScreen approval", "Only launch, render, runtime process and output state are checked; no cue, network or device output is exercised", "The application is stopped by the test (process tree terminated), not quit from its menu"] }, null, 2));
if (failure) { console.error(failure); process.exit(1); }
console.log([...passed.map((line) => `✓ ${line}`), ...notes.map((line) => `! ${line}`)].join("\n"));
process.exit(0);
