import { textPdf, waveAudio, syntheticVideo } from "./fixtures.mjs";
import { unzipSync } from "fflate";
import { createHash } from "node:crypto";
import os from "node:os";
import { _electron as electron, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, mkdir, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import dgram from "node:dgram";
import assert from "node:assert/strict";
// Only an explicitly selected installed executable is accepted. No app source,
// package manager Electron binary, development server or private fixture is used.
const packaged = true;
const expectedVersion = process.env.STAGE4D_EXPECTED_VERSION || "0.3.0";
if (!process.env.STAGE4D_EXECUTABLE || !path.isAbsolute(process.env.STAGE4D_EXECUTABLE)) throw new Error("STAGE4D_EXECUTABLE must identify an installed absolute executable path");
const executablePath = process.env.STAGE4D_EXECUTABLE;
const reportDirectory = path.resolve(process.env.STAGE4D_REPORT_DIR || "reports");
await mkdir(reportDirectory, { recursive: true });
const safeNames = new Set(["PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "TEMP", "TMP", "TMPDIR", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "TZ", "DISPLAY", "WAYLAND_DISPLAY", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"]);
const launchEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => safeNames.has(key.toUpperCase())));
const dir = await mkdtemp(path.join(tmpdir(), "stage4d-public-check-"));
const socket = dgram.createSocket("udp4"),
  packets = [];
socket.on("message", (data) =>
  packets.push({
    address: data.subarray(0, data.indexOf(0)).toString(),
    at: Date.now(),
  }),
);
await new Promise((resolve) => socket.bind(0, "127.0.0.1", resolve));
const port = socket.address().port;
const project = {
  format: "stage4d",
  version: 1,
  id: "electron-validation",
  name: "OSC 실제 송수신 검증",
  company: "",
  updatedAt: new Date().toISOString(),
  stage: {
    layout: "blackbox",
    width: 10,
    depth: 8,
    height: 5,
    grid: 1,
    showAudience: false,
  },
  cast: [],
  assets: [],
  notes: [],
  rehearsals: [],
  scenes: [
    {
      id: "scene-1",
      name: "검증 장면",
      subtitle: "",
      duration: 1.3,
      notes: "",
      entities: [],
      lines: [
        {
          id: "hold-1",
          character: "오퍼레이터",
          text: "GO 대기점",
          time: 0.6,
          hold: true,
          notes: "",
        },
      ],
      cues: [
        {
          id: "a",
          number: "OSC1",
          name: "처음",
          type: "osc",
          enabled: true,
          trigger: "time",
          at: 0.1,
          duration: 0,
          notes: "",
          osc: {
            host: "127.0.0.1",
            port,
            address: "/stage4d/first",
            args: [1, "검증"],
          },
        },
        {
          id: "b",
          number: "OSC2",
          name: "대기점",
          type: "osc",
          enabled: true,
          trigger: "time",
          anchorId: "hold-1",
          at: 0,
          duration: 0,
          notes: "",
          osc: { host: "127.0.0.1", port, address: "/stage4d/hold", args: [] },
        },
        {
          id: "c",
          number: "OSC3",
          name: "마지막",
          type: "osc",
          enabled: true,
          trigger: "time",
          at: 1.3,
          duration: 0,
          notes: "",
          osc: { host: "127.0.0.1", port, address: "/stage4d/end", args: [] },
        },
      ],
    },
  ],
};
// Hosted virtual machines may have no supported GPU. Explicit SwANGLE exercises
// real WebGL rendering on the CPU; it never certifies physical GPU performance.
// https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md
const softwareRendering = process.env.STAGE4D_SOFTWARE_RENDERING === "1";
const graphicsArgs = softwareRendering ? ["--use-gl=angle", "--use-angle=swiftshader"] : ["--enable-unsafe-swiftshader"];
const diagnosticArgs = ["--enable-logging=file", `--log-file=${path.join(reportDirectory, "chromium-diagnostics.txt")}`];
const launchArgs = [`--user-data-dir=${dir}`, ...graphicsArgs];
let app;
const launch = (profile = dir) => electron.launch({ executablePath, args: [`--user-data-dir=${profile}`, ...graphicsArgs, ...diagnosticArgs], env: launchEnvironment });
const results = [],
  errors = [];
let execution;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const nav = (page, name) => page.getByRole("navigation", { name: "작업 공간" }).getByRole("button", { name, exact: true }).click();
const saved = page => expect(page.locator(".save-state")).toHaveText("이 기기에 저장됨");
async function firstWindow() {
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(30000);
  page.on("pageerror", error => errors.push(error.message));
  await expect(page.locator("canvas").first()).toBeVisible();
  return page;
}
async function requireWebGL(page) {
  let state;
  try {
  await expect.poll(async () => {
    state = await page.locator("canvas").first().evaluate(canvas => {
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (!gl) return { ready: false, reason: "No WebGL context" };
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        ready: !gl.isContextLost() && gl.drawingBufferWidth > 100 && gl.drawingBufferHeight > 100,
        contextLost: gl.isContextLost(),
        version: gl.getParameter(gl.VERSION),
        renderer: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
        drawingBufferWidth: gl.drawingBufferWidth,
        drawingBufferHeight: gl.drawingBufferHeight,
      };
    });
    return state.ready;
  }, { timeout: 15000, message: "The actual stage canvas must have a live WebGL context" }).toBe(true);
  } catch (error) {
    error.message += `\nLast WebGL state: ${JSON.stringify(state)}`;
    throw error;
  }
  return state;
}
async function exportProject(page, name) {
  const file = path.join(dir, name);
  // Select the temporary save location through Electron's download API. This
  // still exercises the real UI exporter, while avoiding a native save dialog
  // and never writing to the user's Downloads folder.
  await app.evaluate(({ BrowserWindow }, file) => {
    globalThis.__stage4dDownload = { state: "waiting" };
    BrowserWindow.getAllWindows()[0].webContents.session.once("will-download", (_event, item) => {
      item.setSavePath(file);
      globalThis.__stage4dDownload.filename = item.getFilename();
      item.once("done", (_event, state) => { globalThis.__stage4dDownload.state = state; });
    });
  }, file);
  await page.getByRole("button", { name: "프로젝트 저장", exact: true }).click();
  await expect.poll(() => app.evaluate(() => globalThis.__stage4dDownload.state), { timeout: 30000 }).toBe("completed");
  const filename = await app.evaluate(() => globalThis.__stage4dDownload.filename);
  const entries = unzipSync(new Uint8Array(await readFile(file)));
  assert.ok(entries["project.json"], "Export includes its project manifest");
  return { file, filename, entries, project: JSON.parse(Buffer.from(entries["project.json"]).toString("utf8")) };
}
async function previewMedia(page, name, kind) {
  await nav(page, "미디어");
  await page.locator(".asset-card").filter({ hasText: name }).getByRole("button", { name: "미리보기", exact: true }).click();
  if (kind === "pdf") {
    await expect.poll(() => page.locator(".media-pdf canvas").evaluate(canvas => canvas.width), { timeout: 15000 }).toBeGreaterThan(100);
    await expect(page.locator(".media-pdf-toolbar")).toContainText("1 / 1");
    await page.getByRole("button", { name: "미리보기 닫기" }).click();
  } else {
    const media = page.locator(`.media-modal ${kind}`);
    await media.evaluate(async element => { element.muted = true; await element.play(); });
    await expect.poll(() => media.evaluate(element => element.currentTime), { timeout: 15000 }).toBeGreaterThan(0.15);
    const handle = await media.elementHandle();
    await page.getByRole("button", { name: "미리보기 닫기" }).click();
    assert.equal(await handle.evaluate(element => element.paused && element.getAttribute("src") === null), true);
    await handle.dispose();
  }
}
try {
  app = await launch();
  execution = await app.evaluate(({ app }) => ({ platform: process.platform, architecture: process.arch, runningUnderARM64Translation: app.runningUnderARM64Translation, gpu: app.getGPUFeatureStatus() }));
  execution.host = { platform: process.platform, architecture: process.arch, release: os.release() };
  if (process.env.STAGE4D_EXPECTED_ARCH) assert.equal(execution.architecture, process.env.STAGE4D_EXPECTED_ARCH);
  if (process.env.STAGE4D_REQUIRE_NATIVE === "1") {
    assert.equal(execution.platform, process.platform);
    assert.equal(execution.architecture, process.arch);
    assert.ok(!execution.runningUnderARM64Translation, "This check requires a native host, not Rosetta");
  }
  if (packaged) {
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
    assert.equal(
      await app.evaluate(({ app }) => app.getVersion()),
      expectedVersion,
    );
    results.push(
      `Packaged stage4d v${expectedVersion} launches independently from Vite`,
    );
  }
  let page = await firstWindow();
  execution.renderingMode = softwareRendering ? "explicit-swiftshader-cpu" : "default-with-software-fallback-permitted";
  execution.gpu = await app.evaluate(({ app }) => app.getGPUFeatureStatus());
  assert.ok(await page.evaluate(() => Boolean(window.stage4d)));
  const userData = await app.evaluate(({ app }) => app.getPath("userData"));
  assert.equal(await realpath(userData), await realpath(dir));
  const menuRoles = await app.evaluate(({ Menu }) => {
    function roles(menu) {
      return menu.items.flatMap((item) => [
        item.role,
        ...(item.submenu ? roles(item.submenu) : []),
      ]);
    }
    return roles(Menu.getApplicationMenu());
  });
  assert.ok(!menuRoles.includes("reload"));
  assert.ok(!menuRoles.includes("toggledevtools"));
  results.push("production menu omits reload and developer tools");
  await page.locator("header input[type=file]").setInputFiles({
    name: "fixture.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.getByRole("textbox", { name: "공연 이름", exact: true }))
    .toHaveValue(project.name, { timeout: 15000 });
  await expect(page.locator(".save-state")).toHaveText("이 기기에 저장됨");
  await app.evaluate(({ app, BrowserWindow }) => {
    globalThis.__stage4dSecondLaunches = 0;
    app.on("second-instance", () => globalThis.__stage4dSecondLaunches++);
    BrowserWindow.getAllWindows()[0].minimize();
  });
  const secondEnv = { ...launchEnvironment };
  delete secondEnv.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve, reject) => {
    const child = spawn(executablePath, launchArgs, {
      cwd: process.cwd(),
      env: secondEnv,
      stdio: "ignore",
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Second instance did not exit within 15 seconds"));
    }, 15000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      code === 0 ? resolve() : reject(new Error(`Second instance exited ${code}`));
    });
  });
  await expect.poll(() => app.evaluate(() => globalThis.__stage4dSecondLaunches), { timeout: 10000 }).toBe(1);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), { timeout: 10000 }).toBe(false);
  const windowsAfterLaunch = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => ({
      visible: window.isVisible(),
      minimized: window.isMinimized(),
    })),
  );
  assert.deepEqual(windowsAfterLaunch, [{ visible: true, minimized: false }]);
  assert.equal(
    await page
      .getByRole("textbox", { name: "공연 이름", exact: true })
      .inputValue(),
    project.name,
  );
  results.push(
    "repeated launch exits and restores the existing editor without changing its project",
  );
  execution.webgl = await requireWebGL(page);
  await page.screenshot({ path: path.join(reportDirectory, "studio-webgl.png") });
  results.push("Stage canvas has a live WebGL context with a nonzero drawing buffer; actual renderer is recorded");
  const unarmed = await page.evaluate(
    (port) =>
      window.stage4d.sendOsc({
        host: "127.0.0.1",
        port,
        address: "/stage4d/blocked",
        args: [],
      }),
    port,
  );
  assert.equal(unarmed.sent, false);
  assert.equal(packets.length, 0);
  results.push(
    "isolated native app, production files and preload bridge; unarmed output refused",
  );
  await page.getByRole("button", { name: "출력 꺼짐", exact: true }).click();
  await page
    .getByRole("button", { name: "미리보기 재생", exact: true })
    .click();
  await page.waitForTimeout(1650);
  assert.equal(packets.length, 0);
  results.push(
    "armed preview crosses every OSC cue without sending any packet",
  );
  await page.getByRole("button", { name: "정지", exact: true }).click();
  assert.ok(
    await page.getByRole("button", { name: "출력 꺼짐", exact: true }).count(),
  );
  await page.getByRole("button", { name: "출력 꺼짐", exact: true }).click();
  await page.getByRole("button", { name: "GO", exact: true }).click();
  await expect(page.locator(".transport-state")).toContainText("GO 대기", { timeout: 15000 });
  await expect.poll(() => packets.length, { timeout: 10000 }).toBe(1);
  assert.deepEqual(
    packets.map((p) => p.address),
    ["/stage4d/first"],
  );
  assert.match(await page.locator(".transport-state").innerText(), /GO 대기/);
  results.push(
    "GO sends actual localhost UDP once and waits before cue on manual boundary",
  );
  await page.getByRole("button", { name: "GO", exact: true }).click();
  await expect.poll(() => packets.length, { timeout: 15000 }).toBe(3);
  assert.deepEqual(
    packets.map((p) => p.address),
    ["/stage4d/first", "/stage4d/hold", "/stage4d/end"],
  );
  results.push(
    "GO releases boundary exactly once; exact scene-end cue is transmitted",
  );
  await page.getByRole("button", { name: "GO", exact: true }).click();
  await page.waitForTimeout(100);
  assert.equal(packets.length, 3);
  results.push("GO at completed scene does not replay");
  const rejected = await page.evaluate(
    (port) =>
      window.stage4d.sendOsc({
        host: "8.8.8.8",
        port,
        address: "/stage4d/rejected",
        args: [],
      }),
    port,
  );
  assert.equal(rejected.sent, false);
  results.push("non-local output target refused before UDP");
  await page.getByRole("button", { name: "정지", exact: true }).click();
  const stopped = await page.evaluate(
    (port) =>
      window.stage4d.sendOsc({
        host: "127.0.0.1",
        port,
        address: "/stage4d/stopped",
        args: [],
      }),
    port,
  );
  assert.equal(stopped.sent, false);
  assert.equal(packets.length, 3);
  results.push("STOP disarms native bridge, not only UI");
  await page.evaluate(() => window.stage4d.arm(true));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("canvas");
  execution.webglAfterReload = await requireWebGL(page);
  assert.equal(
    await page
      .getByRole("textbox", { name: "공연 이름", exact: true })
      .inputValue(),
    project.name,
  );
  assert.ok(
    await page.getByRole("button", { name: "출력 꺼짐", exact: true }).count(),
  );
  const afterReload = await page.evaluate(
    (port) => window.stage4d.sendOsc({
      host: "127.0.0.1", port, address: "/stage4d/reloaded", args: [],
    }), port,
  );
  assert.equal(afterReload.sent, false);
  assert.equal(packets.length, 3);
  results.push("native project survives reload; output resets off");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "대본", exact: true })
    .click();
  await page.locator(".script-panel input[type=file]").setInputFiles({
    name: "native-script.pdf",
    mimeType: "application/pdf",
    buffer: textPdf(),
  });
  await page.getByText("Native PDF import works.", { exact: false }).waitFor();
  results.push(
    "native file:// PDF import works with bundled worker and production CSP",
  );
  if (process.platform === "darwin") {
    await page.evaluate(() => window.stage4d.arm(true));
    const closed = page.waitForEvent("close");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    await closed;
    // Playwright's page-close event can precede destruction of the native
    // BrowserWindow, particularly when the x64 app runs through Rosetta.
    await expect.poll(
      () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      { timeout: 5000 },
    ).toBe(0);
    const reopened = app.waitForEvent("window");
    await app.evaluate(({ app }) => app.emit("activate"));
    page = await reopened;
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.waitForSelector("canvas");
    assert.equal(
      await page
        .getByRole("textbox", { name: "공연 이름", exact: true })
        .inputValue(),
      project.name,
    );
    const afterReopen = await page.evaluate(
      (port) => window.stage4d.sendOsc({
        host: "127.0.0.1", port, address: "/stage4d/reopened", args: [],
      }), port,
    );
    assert.equal(afterReopen.sent, false);
    assert.equal(packets.length, 3);
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "대본", exact: true })
      .click();
    await page.getByText("Native PDF import works.", { exact: false }).waitFor();
    results.push(
      "Mac window close and activate reopen preserve the project and imported script and reset native OSC arming",
    );
  }
  const mediaFixtures = [
    { name: "synthetic-tone.wav", mimeType: "audio/wav", buffer: waveAudio() },
    { name: "synthetic-block.webm", mimeType: "video/webm", buffer: await syntheticVideo(page) },
    { name: "synthetic-script.pdf", mimeType: "application/pdf", buffer: textPdf() },
  ];
  await nav(page, "미디어");
  await page.locator(".media-library input[multiple]").setInputFiles(mediaFixtures);
  await expect(page.locator(".asset-card")).toHaveCount(3);
  await saved(page);
  await previewMedia(page, "synthetic-tone.wav", "audio");
  await previewMedia(page, "synthetic-block.webm", "video");
  await previewMedia(page, "synthetic-script.pdf", "pdf");
  results.push("Synthetic WAV and WebM decode and advance in native previews; closing releases media; PDF renders through the bundled worker");

  // A reserved Windows name exercises portable filename normalization on both OSes.
  await page.getByRole("textbox", { name: "공연 이름", exact: true }).fill("CON");
  await page.getByRole("textbox", { name: "공연 이름", exact: true }).press("Enter");
  await saved(page);
  const exported = await exportProject(page, "transfer.stage4d");
  assert.equal(exported.filename, "_CON.stage4d");
  assert.equal(exported.project.name, "CON");
  assert.equal(exported.project.assets.length, 3);
  for (const fixture of mediaFixtures) {
    const asset = exported.project.assets.find(asset => asset.name === fixture.name);
    assert.ok(asset, `${fixture.name} metadata is present`);
    assert.equal(hash(exported.entries[`assets/${asset.id}`]), hash(fixture.buffer));
  }
  results.push("Project UI export includes all three media originals byte-for-byte and creates Windows-safe _CON.stage4d");

  await page.evaluate(() => window.stage4d.arm(true));
  await app.close(); app = undefined;
  app = await launch(); page = await firstWindow();
  await expect(page.getByRole("textbox", { name: "공연 이름", exact: true })).toHaveValue("CON");
  await expect(page.getByRole("button", { name: "출력 꺼짐", exact: true })).toBeVisible();
  await nav(page, "대본");
  await page.getByText("Native PDF import works.", { exact: false }).waitFor();
  await previewMedia(page, "synthetic-block.webm", "video");
  await previewMedia(page, "synthetic-tone.wav", "audio");
  results.push("Full application quit/relaunch preserves project, imported script, audio and video with output disarmed");
  await app.close(); app = undefined;

  const recipient = path.join(dir, "recipient-profile");
  app = await launch(recipient); page = await firstWindow();
  await page.locator("header input[type=file]").setInputFiles(exported.file);
  await expect(page.getByRole("textbox", { name: "공연 이름", exact: true })).toHaveValue("CON");
  await saved(page);
  await previewMedia(page, "synthetic-block.webm", "video");
  await previewMedia(page, "synthetic-script.pdf", "pdf");
  const transferred = await exportProject(page, "transferred.stage4d");
  assert.deepEqual(transferred.project, exported.project);
  for (const asset of exported.project.assets) assert.equal(hash(transferred.entries[`assets/${asset.id}`]), hash(exported.entries[`assets/${asset.id}`]));
  results.push("An independent empty profile imports the .stage4d file, plays its media and re-exports identical project/media content");
  assert.equal(packets.length, 3, "Persistence and media tests must not emit additional OSC output");
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(reportDirectory, "desktop-passed.png") });
  await writeFile(
    path.join(reportDirectory, "desktop-results.json"),
    JSON.stringify({ success: true, version: expectedVersion, execution, passed: results, packets, errors, limitations: ["Software rendering is permitted for CI; physical GPU quality, audio output devices and production lighting desks are not tested", "Direct executable launch does not validate Gatekeeper or SmartScreen approval", "OAuth providers and long-duration performances are outside this binary smoke test"] }, null, 2),
  );
  console.log(
    JSON.stringify(
      { execution, passed: results, packets: packets.map((p) => p.address), errors },
      null,
      2,
    ),
  );
} catch (e) {
  if (app && execution) {
    let diagnosticTimer;
    try {
      execution.gpuAtFailure = await Promise.race([
        app.evaluate(async ({ app }) => {
          try { return await app.getGPUInfo("complete"); }
          catch (error) { return { error: String(error) }; }
        }).catch(error => ({ error: String(error) })),
        new Promise(resolve => { diagnosticTimer = setTimeout(() => resolve({ error: "GPU diagnostic request timed out after 5 seconds" }), 5000); }),
      ]);
    } finally { clearTimeout(diagnosticTimer); }
  }
  console.error(e);
  console.error({ results, packets, errors });
  const windows = app?.windows() || [];
  if (windows[0])
    await windows[0]
      .screenshot({ path: path.join(reportDirectory, "desktop-failure.png") })
      .catch(() => {});
  await writeFile(path.join(reportDirectory, "desktop-results.json"), JSON.stringify({ success: false, version: expectedVersion, execution, passed: results, packets, errors, failure: String(e), failed: true }, null, 2));
  process.exitCode = 1;
} finally {
  const cleanupFailures = [];
  try { await app?.close(); }
  catch (error) {
    cleanupFailures.push(`Application shutdown failed: ${String(error)}`);
    app?.process()?.kill();
  } finally { socket.close(); }
  try { await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
  catch (error) { cleanupFailures.push(`Temporary-profile cleanup failed: ${String(error)}`); }
  if (cleanupFailures.length) {
    process.exitCode = 1;
    console.error(cleanupFailures.join("\n"));
    const reportPath = path.join(reportDirectory, "desktop-results.json");
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    await writeFile(reportPath, JSON.stringify({ ...report, success: false, failed: true, cleanupFailures }, null, 2));
  }
}
