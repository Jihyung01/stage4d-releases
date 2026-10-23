// Builds an UNSIGNED Microsoft Store AppX from the published Windows x64 installer of a stage4d release.
// The Store re-signs accepted packages. Never distribute this AppX outside Partner Center.
// Runs on Windows x64 only (electron-builder's AppX toolchain). No secrets are used.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rm, readdir, cp, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = path.join(here, "work");
const env = process.env;
const need = (name, max) => {
  const value = (env[name] ?? "").trim();
  if (!value || value.length > max || /[\u0000-\u001f]/.test(value)) throw new Error(`${name} is required (Partner Center › Product identity).`);
  return value;
};
if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Build the Store AppX on Windows x64.");
const appVersion = need("STAGE4D_VERSION", 23);
if (!/^\d+\.\d+\.\d+$/.test(appVersion)) throw new Error("STAGE4D_VERSION must be the released app version, e.g. 0.5.0.");
const identityName = need("STORE_IDENTITY_NAME", 50);
if (!/^[A-Za-z0-9.-]{3,50}$/.test(identityName)) throw new Error("STORE_IDENTITY_NAME must be the exact Package/Identity/Name.");
const publisher = need("STORE_PUBLISHER", 8192);
if (!/^CN=/.test(publisher)) throw new Error("STORE_PUBLISHER must be the exact CN=… Package/Identity/Publisher.");
const publisherDisplayName = need("STORE_PUBLISHER_DISPLAY_NAME", 256);
const storeVersion = need("STORE_VERSION", 23);
const parts = storeVersion.split(".").map(Number);
if (parts.length !== 4 || parts[3] !== 0 || parts[0] < 1 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 65535)) {
  throw new Error("STORE_VERSION must be Major.Minor.Patch.0 with Major ≥ 1 (the last field is reserved for the Store).");
}
const displayName = (env.STORE_DISPLAY_NAME ?? "").trim() || "stage4d";
for (const value of [identityName, publisher, publisherDisplayName, displayName]) if (/mdescort/i.test(value)) throw new Error("Prohibited account.");
const placeholder = /PLACEHOLDER/i.test(identityName + publisher);

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: false, ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${args[0] ?? ""} failed (${r.status}).`);
};
const sha256 = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");

await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });
const base = `https://github.com/Jihyung01/stage4d-releases/releases/download/v${appVersion}`;
const manifest = await (await fetch(`${base}/release-info.json`)).json();
if (manifest.version !== appVersion) throw new Error(`release-info.json is for ${manifest.version}, expected ${appVersion}.`);
const setupName = `stage4d-${appVersion}-win-x64-setup.exe`;
const entry = manifest.artifacts.find((a) => a.name === setupName);
if (!entry) throw new Error(`${setupName} is not in the published manifest.`);
const setupPath = path.join(work, setupName);
const response = await fetch(entry.url);
if (!response.ok) throw new Error(`Download failed: ${response.status}`);
await writeFile(setupPath, Buffer.from(await response.arrayBuffer()));
if ((await stat(setupPath)).size !== entry.bytes || (await sha256(setupPath)) !== entry.sha256) throw new Error("Installer size or SHA-256 does not match the published manifest.");
console.log(`Verified ${setupName} (${entry.bytes} bytes, ${entry.sha256}).`);

// NSIS installer → $PLUGINSDIR/app-64.7z → application directory
run("7z", ["x", "-y", `-o${path.join(work, "nsis")}`, setupPath], { stdio: "ignore" });
const payload = path.join(work, "nsis", "$PLUGINSDIR", "app-64.7z");
const appDir = path.join(work, "stage4d-app");
run("7z", ["x", "-y", `-o${appDir}`, payload], { stdio: "ignore" });
for (const required of ["stage4d.exe", "resources/app.asar", "resources/THIRD_PARTY_NOTICES.txt"]) {
  await stat(path.join(appDir, required)).catch(() => { throw new Error(`Extracted application is missing ${required}.`); });
}

// Build resources: Store tiles + identity manifest (protocol + capabilities match the desktop app)
const resources = path.join(work, "build");
await mkdir(path.join(resources, "appx"), { recursive: true });
await cp(path.join(here, "assets"), path.join(resources, "appx"), { recursive: true });
const xml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const manifestXml = `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
 xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
 xmlns:desktop="http://schemas.microsoft.com/appx/manifest/desktop/windows10"
 xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
 IgnorableNamespaces="uap desktop rescap">
 <Identity Name="${xml(identityName)}" Publisher="${xml(publisher)}" Version="${storeVersion}" ProcessorArchitecture="\${arch}" />
 <Properties>
  <DisplayName>${xml(displayName)}</DisplayName>
  <PublisherDisplayName>${xml(publisherDisplayName)}</PublisherDisplayName>
  <Description>3D performance production studio for blocking, scripts, lighting, media and run of show</Description>
  <Logo>\${logo}</Logo>
 </Properties>
 <Resources>\${resourceLanguages}</Resources>
 <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="\${minVersion}" MaxVersionTested="\${maxVersionTested}" /></Dependencies>
 \${capabilities}
 <Applications>
  <Application Id="stage4d" Executable="\${executable}" EntryPoint="Windows.FullTrustApplication">
   <uap:VisualElements DisplayName="${xml(displayName)}" Description="stage4d performance studio" BackgroundColor="#171c22" Square150x150Logo="\${square150x150Logo}" Square44x44Logo="\${square44x44Logo}">
    \${defaultTile}
   </uap:VisualElements>
   <Extensions>
    <uap:Extension Category="windows.protocol"><uap:Protocol Name="com.stage4d.studio"><uap:DisplayName>stage4d account sign-in</uap:DisplayName></uap:Protocol></uap:Extension>
   </Extensions>
  </Application>
 </Applications>
</Package>
`;
await writeFile(path.join(work, "AppxManifest.template.xml"), manifestXml, "utf8");
const project = path.join(work, "project");
await mkdir(project, { recursive: true });
await writeFile(path.join(project, "package.json"), JSON.stringify({ name: "stage4d", productName: "stage4d", version: appVersion, description: "stage4d performance studio", author: publisherDisplayName }, null, 2));
const out = path.join(here, "out");
await rm(out, { recursive: true, force: true });
// The prepackaged app carries no node_modules; give electron-builder the Electron runtime it was built with.
const electronVersion = (env.STAGE4D_ELECTRON_VERSION ?? "").trim() || "45.0.0";
if (!/^\d+\.\d+\.\d+$/.test(electronVersion)) throw new Error("STAGE4D_ELECTRON_VERSION must look like 45.0.0.");
const config = {
  appId: "com.stage4d.studio",
  electronVersion,
  productName: "stage4d",
  directories: { output: out, buildResources: resources },
  publish: null,
  forceCodeSigning: false,
  artifactName: `stage4d-${appVersion}-store-x64.\${ext}`,
  win: { target: [{ target: "appx", arch: ["x64"] }], signExecutable: false },
  appx: {
    applicationId: "stage4d",
    identityName, publisher, publisherDisplayName, displayName,
    customManifestPath: path.join(work, "AppxManifest.template.xml"),
    capabilities: ["runFullTrust", "internetClient", "privateNetworkClientServer"],
    languages: ["ko-KR"],
    backgroundColor: "#171c22",
    minVersion: "10.0.19041.0",
    maxVersionTested: "10.0.19041.0",
    setBuildNumber: false,
    addAutoLaunchExtension: false,
    showNameOnTiles: false,
    electronUpdaterAware: false,
  },
};
const configPath = path.join(work, "electron-builder.store.json");
await writeFile(configPath, JSON.stringify(config, null, 2));
const cli = path.join(here, "node_modules", "electron-builder", "cli.js");
run(process.execPath, [cli, "--projectDir", project, "--config", configPath, "--win", "appx", "--x64", "--prepackaged", appDir, "--publish", "never"], { env: { ...env, CSC_IDENTITY_AUTO_DISCOVERY: "false" } });

const appx = (await readdir(out)).find((f) => f.endsWith(".appx"));
if (!appx) throw new Error("No AppX was produced.");
const appxPath = path.join(out, appx);
// Inspect the package: manifest identity, executable, payload, and no signature (the Store signs it).
const listing = spawnSync("7z", ["l", "-ba", appxPath], { encoding: "utf8" }).stdout;
for (const required of ["AppxManifest.xml", "AppxBlockMap.xml", "[Content_Types].xml", "app\\stage4d.exe", "app\\resources\\app.asar"]) {
  if (!listing.includes(required)) throw new Error(`AppX is missing ${required}.`);
}
if (listing.includes("AppxSignature.p7x")) throw new Error("Expected an unsigned Store submission.");
run("7z", ["e", "-y", `-o${path.join(work, "check")}`, appxPath, "AppxManifest.xml"], { stdio: "ignore" });
const built = await readFile(path.join(work, "check", "AppxManifest.xml"), "utf8");
for (const value of [`Name="${xml(identityName)}"`, `Publisher="${xml(publisher)}"`, `Version="${storeVersion}"`, 'ProcessorArchitecture="x64"', 'Executable="app\\stage4d.exe"', '<uap:Protocol Name="com.stage4d.studio">', 'Name="runFullTrust"']) {
  if (!built.includes(value)) throw new Error(`AppX manifest is missing ${value}.`);
}
if (/\$\{/.test(built)) throw new Error("AppX manifest contains unexpanded macros.");
await writeFile(path.join(out, "AppxManifest.xml"), built, "utf8");
const digest = await sha256(appxPath);
await writeFile(path.join(out, "SHA256SUMS.txt"), `${digest}  ${appx}\n`);
await writeFile(path.join(out, "store-package.json"), JSON.stringify({ appVersion, storeVersion, identityName, publisher, publisherDisplayName, displayName, appx, bytes: (await stat(appxPath)).size, sha256: digest, source: entry.url, sourceSha256: entry.sha256, placeholderIdentity: placeholder, signed: false }, null, 2));
console.log(`${placeholder ? "TEST (placeholder identity, do not submit)" : "Store submission"} AppX: ${appx} ${digest}`);
