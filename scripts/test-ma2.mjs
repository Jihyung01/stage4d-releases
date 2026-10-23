import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import dgram from "node:dgram";
import assert from "node:assert/strict";
const profile = await mkdtemp(path.join(tmpdir(), "stage4d-ma2-"));
const socket = dgram.createSocket("udp4"),
  packets = [];
socket.on("message", (b) => packets.push(b));
await new Promise((resolve, reject) => {
  socket.once("error", reject);
  socket.bind(6004, "127.0.0.1", resolve);
});
const cmd = {
  host: "127.0.0.1",
  port: 6004,
  deviceId: 1,
  commandFormat: 127,
  action: "goto",
  cue: "23.125",
  executorMode: "exec-dot-page",
  executor: 2,
  page: 1,
};
const fixture = {
  format: "stage4d",
  version: 1,
  id: "ma2-native-isolated",
  name: "MA2 UDP 검증 · 실제 콘솔 아님",
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
      id: "s",
      name: "독립 테스트",
      subtitle: "",
      duration: 1,
      entities: [],
      lines: [],
      notes: "",
      cues: [
        {
          id: "msc",
          number: "MSC1",
          name: "지정 큐",
          type: "osc",
          enabled: true,
          at: 0,
          trigger: "time",
          duration: 0,
          notes: "",
          ma2: cmd,
        },
      ],
    },
  ],
};
if (!process.env.STAGE4D_EXECUTABLE || !path.isAbsolute(process.env.STAGE4D_EXECUTABLE)) throw Error("Installed executable required");
const safeNames = new Set(["PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "TMPDIR", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "LANG"]);
const launchEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => safeNames.has(key.toUpperCase())));
const app = await electron.launch({
  executablePath: process.env.STAGE4D_EXECUTABLE,
  env: launchEnvironment,
  args: [
    ...(process.env.STAGE4D_SOFTWARE_RENDERING === "1" ? ["--use-gl=angle", "--use-angle=swiftshader"] : []),
    `--user-data-dir=${profile}`,
  ],
  cwd: process.cwd(),
});
const results = [];
try {
  const page = await app.firstWindow();
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30000 });
  assert.equal(
    (await page.evaluate((c) => window.stage4d.sendMa2(c), cmd)).sent,
    false,
  );
  await page
    .locator("header input[type=file]")
    .setInputFiles({
      name: "ma2.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(fixture)),
    });
  await expect(page.getByLabel("공연 이름", { exact: true })).toHaveValue(
    fixture.name,
  );
  await page
    .getByRole("button", { name: "미리보기 재생", exact: true })
    .click();
  await page.waitForTimeout(250);
  assert.equal(packets.length, 0);
  await page.getByRole("button", { name: "정지", exact: true }).click();
  results.push("MA2 blocked before arming and during preview");
  await page.getByRole("button", { name: "출력 꺼짐", exact: true }).click();
  await page.getByRole("button", { name: "GO", exact: true }).click();
  await expect.poll(() => packets.length).toBe(1);
  await page.waitForTimeout(200);
  assert.equal(packets.length, 1);
  assert.equal(packets[0].subarray(0, 8).toString(), "GMA\0MSC\0");
  assert.equal(packets[0].readUInt32LE(8), packets[0].length);
  assert.equal(
    packets[0].subarray(12).toString("hex"),
    "f07f01027f0132332e31323500322e31f7",
  );
  results.push(
    "Armed rehearsal GO emits one exact MSC datagram to local UDP receiver",
  );
  await page.reload();
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30000 });
  assert.equal(
    (await page.evaluate((c) => window.stage4d.sendMa2(c), cmd)).sent,
    false,
  );
  results.push("Window reload disarms native MA2 output");
  await page.evaluate(() => window.stage4d.arm(true));
  assert.equal(
    (
      await page.evaluate(
        (c) => window.stage4d.sendMa2({ ...c, host: "8.8.8.8" }),
        cmd,
      )
    ).sent,
    false,
  );
  assert.equal(packets.length, 1);
  results.push("Native process rejects invalid nonlocal targets");
  await mkdir("reports", { recursive: true });
  await writeFile(
    "reports/ma2-native-results.json",
    JSON.stringify(
      {
        version: await app.evaluate(({ app }) => app.getVersion()),
        results,
        scope: "Local UDP receiver; no grandMA2 console/onPC available",
      },
      null,
      2,
    ),
  );
  console.log(results);
} finally {
  await app.close();
  socket.close();
  await rm(profile, { recursive: true, force: true });
}
