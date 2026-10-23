# Public installer validation

This repository contains independent tests for the published stage4d 0.3.0 installers. It does not contain the application source, credentials, customer projects or private fixtures. The test creates its own project, PDF, WAV tone and WebM animation and removes the temporary application profiles afterward.

The `Validate published installers` workflow is manually started with `all`, `windows` or `macos`. It downloads the public assets without an account token and verifies their exact byte count and SHA-256 against `validation-assets.json` before installation. The workflow does not build, sign, upload release assets or publish a release. Node, npm dependencies and GitHub Actions are pinned.

The two jobs use standard `windows-2025` and `macos-15-intel` runners. Standard GitHub-hosted runners are free for public repositories; these jobs do not request larger runners. See [GitHub's runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). Repository or account restrictions can still prevent a job from starting; a skipped/blocked job is not a successful test.

## What is tested

- The downloaded binary's packaged version, native OS/architecture, preload bridge, production menu, visible canvas and absence of renderer errors.
- An isolated user profile, JSON import and saved project, repeated launch returning to the existing window, reload and full process restart.
- Actual loopback UDP packets: preview sends none, GO pauses at the manual cue boundary, the next GO sends each remaining cue once, and STOP/reload/restart disarm output. A non-local destination is rejected.
- Synthetic audio/video decoding and advancing playback; closing previews releases the source. PDF text imports and the bundled PDF renderer displays a page.
- `.stage4d` export and import into a second empty profile; media bytes match SHA-256 before and after transfer. The reserved Windows project name `CON` produces `_CON.stage4d`.
- Windows: NSIS install in a directory with spaces; the exact quoted HKCU protocol command; real uninstallation; and preservation of a replacement protocol owner's registration during uninstall. The test refuses to run over an existing installation or protocol registration.
- Intel Mac: DMG integrity, copy out of the mounted image, existing bundle seal verification, execution on a native x64 host, and close-window/activate recovery. No Gatekeeper settings or quarantine flags are modified.

Reports and screenshots contain only the synthetic test project. The executable receives a small allowlist of operating-system environment variables, not repository tokens or CI secrets. Downloaded installers, temporary profiles and application data are not uploaded as CI artifacts.

## Local execution

Use an isolated test account or VM, particularly on Windows. Install the exact Node version in `package.json`, then:

```sh
npm ci --ignore-scripts --no-audit --no-fund
```

Windows, PowerShell 7:

```powershell
node scripts/download-release.mjs windows
$env:STAGE4D_EXPECTED_ARCH = 'x64'
$env:STAGE4D_REQUIRE_NATIVE = '1'
./scripts/test-windows-install.ps1
```

Native Intel Mac:

```sh
node scripts/download-release.mjs macos-intel
bash scripts/test-macos-install.sh
```

An Apple Silicon Mac can verify the ARM build independently:

```sh
node scripts/download-release.mjs macos-arm64
STAGE4D_EXPECTED_ARCH=arm64 bash scripts/test-macos-install.sh download/stage4d-0.3.0-mac-arm64.dmg
```

The public workflow deliberately requires native architecture. An Intel binary running under Rosetta is not recorded as native Intel validation.

## Meaning of a passing result

`reports/desktop-results.json` records the runtime architecture, renderer/GPU feature status and each passed check. `reports/windows-install.json` records both Windows installation cycles and cleanup; more detail is available in the job log. Download and macOS installation reports provide additional evidence. The workflow must complete successfully on each target before its native verification claim is updated.

This is automated OS-level smoke testing. The workflow sets `STAGE4D_SOFTWARE_RENDERING=1` to explicitly use Chromium's CPU-based SwiftShader OpenGL ES driver on virtual machines without a supported GPU. It still renders the actual application and does not skip canvas or media checks. The report records this rendering mode. Local runs use the default driver unless that variable is set. See [Chromium's SwiftShader documentation](https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md).

Media playback is muted. These checks do not validate physical audio devices, GPU quality/performance, lighting desks, multi-hour productions, OAuth-provider registration, accessibility coverage, Apple notarization, Gatekeeper acceptance or Windows SmartScreen reputation. The current release is unsigned testing software; these checks do not change its signing status.
