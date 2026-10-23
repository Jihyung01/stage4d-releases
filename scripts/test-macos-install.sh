#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
installer="${1:-download/stage4d-0.3.0-mac-x64.dmg}"
expected_arch="${STAGE4D_EXPECTED_ARCH:-x64}"
[[ "$(uname -s)" == Darwin ]] || { echo 'This test requires macOS.' >&2; exit 1; }
case "$(uname -m)" in
  arm64) host_arch=arm64 ;;
  x86_64) host_arch=x64 ;;
  *) echo 'Unsupported host architecture.' >&2; exit 1 ;;
esac
[[ "$host_arch" == "$expected_arch" ]] || { echo 'Use a native runner matching the downloaded DMG.' >&2; exit 1; }
[[ -f "$installer" ]] || { echo "Missing installer: $installer" >&2; exit 1; }
test_root="$(mktemp -d "${TMPDIR:-/tmp}/stage4d-public-install.XXXXXX")"
mount_path="$test_root/Mounted DMG"
installed_path="$test_root/Installed application/stage4d.app"
mounted=0
cleanup() {
  if [[ "$mounted" == 1 ]]; then hdiutil detach "$mount_path" >/dev/null || true; fi
  rm -rf "$test_root"
}
trap cleanup EXIT
mkdir -p "$mount_path" "$(dirname "$installed_path")" reports
hdiutil verify "$installer"
hdiutil attach "$installer" -readonly -nobrowse -mountpoint "$mount_path" >/dev/null
mounted=1
[[ -d "$mount_path/stage4d.app" ]] || { echo 'DMG does not contain stage4d.app.' >&2; exit 1; }
ditto "$mount_path/stage4d.app" "$installed_path"
hdiutil detach "$mount_path" >/dev/null
mounted=0

# Validate the existing bundle seal only. No re-signing, quarantine removal,
# Gatekeeper exceptions or elevated installation are performed by this test.
codesign --verify --deep --strict --verbose=2 "$installed_path"
codesign --display --verbose=2 "$installed_path" 2>reports/macos-signature.txt
export STAGE4D_EXECUTABLE="$installed_path/Contents/MacOS/stage4d"
export STAGE4D_EXPECTED_VERSION=0.3.0
export STAGE4D_EXPECTED_ARCH="$expected_arch"
export STAGE4D_REQUIRE_NATIVE=1
node scripts/test-desktop.mjs
cleanup
node --input-type=module -e 'import { writeFile } from "node:fs/promises"; await writeFile("reports/macos-install.json", JSON.stringify({ success: true, version: "0.3.0", host: process.platform, architecture: process.arch, dmgVerified: true, copiedOutOfDmg: true, existingBundleSealVerified: true, notarizationVerified: false, gatekeeperApprovalTested: false, cleanup: "Temporary copied application removed after the test" }, null, 2));'
