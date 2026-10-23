#Requires -Version 7.0
[CmdletBinding()]
param(
  [string]$InstallerPath = (Join-Path $PSScriptRoot "..\download\stage4d-0.3.0-win-x64-setup.exe"),
  [ValidatePattern('^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$')]
  [string]$ExpectedVersion = "0.3.0"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$protocolKey = "HKCU:\Software\Classes\com.stage4d.studio"
$protocolCommandKey = "$protocolKey\shell\open\command"
$harnessRoot = Split-Path -Parent $PSScriptRoot
$harness = Join-Path $PSScriptRoot "test-desktop.mjs"
$reportDirectory = Join-Path $harnessRoot "reports"
$reportPath = Join-Path $reportDirectory "windows-install.json"
$checks = [System.Collections.Generic.List[string]]::new()
$failureStages = [System.Collections.Generic.List[string]]::new()

function Write-InstallReport([bool]$Success, [string]$Failure = "") {
  # Keep this artifact public: only fixed check labels, the requested version
  # and platform are recorded. Never serialize exceptions, paths or environment.
  $report = [ordered]@{
    success = $Success
    version = $ExpectedVersion
    platform = "win32"
    checks = @($checks.ToArray())
  }
  if ($Failure) { $report["failure"] = $Failure }
  $null = New-Item -ItemType Directory -Path $reportDirectory -Force
  $temporaryReport = Join-Path $reportDirectory "windows-install.json.tmp"
  $report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $temporaryReport -Encoding utf8
  Move-Item -LiteralPath $temporaryReport -Destination $reportPath -Force
}

function Assert-CleanTestAccount {
  # Inspect both registry views, including machine-wide entries that this
  # per-user installer must never replace. Access errors are failures, too.
  foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
      $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
      try {
        $scheme = $base.OpenSubKey("Software\Classes\com.stage4d.studio")
        if ($null -ne $scheme) {
          $scheme.Dispose()
          throw "Existing stage4d URL protocol in $hive/$view. Use a clean test account/VM; nothing will be replaced."
        }
        $uninstall = $base.OpenSubKey("Software\Microsoft\Windows\CurrentVersion\Uninstall")
        if ($null -ne $uninstall) {
          try {
            foreach ($name in $uninstall.GetSubKeyNames()) {
              $entry = $uninstall.OpenSubKey($name)
              if ($null -eq $entry) { continue }
              try {
                if ([string]$entry.GetValue("DisplayName") -match '(?i)^stage4d(?:\s|$)') {
                  throw "Existing stage4d installation in $hive/$view. Use a clean test account/VM."
                }
              } finally { $entry.Dispose() }
            }
          } finally { $uninstall.Dispose() }
        }
      } finally { $base.Dispose() }
    }
  }
  foreach ($directory in @(
    (Join-Path $env:LOCALAPPDATA "Programs\stage4d"),
    (Join-Path $env:LOCALAPPDATA "stage4d"),
    (Join-Path $env:ProgramFiles "stage4d"),
    (Join-Path ${env:ProgramFiles(x86)} "stage4d")
  )) {
    if (Test-Path -LiteralPath (Join-Path $directory "stage4d.exe")) {
      throw "Existing stage4d executable at $directory. Use a clean test account/VM."
    }
  }
  if (Get-Process -Name stage4d -ErrorAction SilentlyContinue) {
    throw "A stage4d process is already running. Use a clean test account/VM."
  }
}

function Get-ProtocolCommand {
  if (-not (Test-Path -LiteralPath $protocolCommandKey)) { return $null }
  $key = Get-Item -LiteralPath $protocolCommandKey
  try {
    return $key.GetValue("", $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  } finally { $key.Dispose() }
}

function Assert-ProtocolRegistration([string]$ExpectedCommand) {
  if ((Get-ProtocolCommand) -cne $ExpectedCommand) {
    throw 'The HKCU protocol command must be exactly the quoted installed executable followed by "%1".'
  }
  $key = Get-Item -LiteralPath $protocolKey
  try {
    if (-not ($key.GetValueNames() -contains "URL Protocol") -or
        $key.GetValueKind("URL Protocol") -ne [Microsoft.Win32.RegistryValueKind]::String -or
        $key.GetValue("URL Protocol") -cne "") {
      throw "The HKCU URL Protocol marker must be an empty REG_SZ value."
    }
  } finally { $key.Dispose() }
}

function Invoke-InstallationCycle([string]$Directory, [switch]$TestDesktop, [switch]$TestReplacementOwner) {
  Assert-CleanTestAccount
  $app = Join-Path $Directory "stage4d.exe"
  $uninstaller = Join-Path $Directory "Uninstall stage4d.exe"
  $expectedCommand = '"' + $app + '" "%1"'
  # This is a simulated successor's registration, not a second running app.
  # It lives under our unique test root and is removed only while still ours.
  $replacementApp = Join-Path $testRoot "Replacement owner path\stage4d.exe"
  $replacementCommand = '"' + $replacementApp + '" "%1"'
  $replacementWritten = $false
  $installationSucceeded = $false
  $failures = [System.Collections.Generic.List[System.Management.Automation.ErrorRecord]]::new()

  try {
    # NSIS consumes the full remainder after /D=, including spaces. Do not add
    # quotes around /D's value, and always keep /D as the final argument.
    $process = Start-Process -FilePath $installer -ArgumentList @("/S", "/currentuser", "/D=$Directory") -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Installer exited with $($process.ExitCode)." }
    $installationSucceeded = $true
    if (-not (Test-Path -LiteralPath $app -PathType Leaf)) { throw "Installer did not create $app." }
    if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw "Installer did not create its uninstaller." }
    Assert-ProtocolRegistration $expectedCommand

    if ($TestDesktop) {
      $env:STAGE4D_EXECUTABLE = $app
      $env:STAGE4D_EXPECTED_VERSION = $ExpectedVersion
      & $node scripts/test-desktop.mjs
      if ($LASTEXITCODE -ne 0) { throw "Installed application checks exited with $LASTEXITCODE." }
    }

    if ($TestReplacementOwner) {
      # Change only a command that this installation owns. A concurrent change
      # by another program must never be overwritten by this check.
      Assert-ProtocolRegistration $expectedCommand
      Set-Item -LiteralPath $protocolCommandKey -Value $replacementCommand
      $replacementWritten = $true
      Assert-ProtocolRegistration $replacementCommand
    }
  } catch {
    $failures.Add($_)
    $failureStages.Add("Installation, protocol or desktop validation failed.")
  } finally {
    try {
      if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
        # _?= prevents NSIS from copying/detaching the uninstaller, making
        # -Wait cover removal. It must be last and its value must be unquoted.
        # Never pass --delete-app-data: user data must not be removed.
        $process = Start-Process -FilePath $uninstaller -ArgumentList @("/S", "/currentuser", "_?=$Directory") -Wait -PassThru
        if ($process.ExitCode -ne 0) { throw "Uninstaller exited with $($process.ExitCode)." }
      } elseif ($installationSucceeded -or (Test-Path -LiteralPath $app)) {
        throw "The installation has no uninstaller; test files were retained at $Directory."
      }
      if (Test-Path -LiteralPath $app) { throw "Uninstaller left the installed application at $app." }
      if ($replacementWritten) {
        Assert-ProtocolRegistration $replacementCommand
        Write-Host "Uninstall preserved the replacement owner's quoted protocol registration."
      } elseif (Test-Path -LiteralPath $protocolKey) {
        throw "Uninstaller left a protocol registration behind. The check will not delete it."
      }
    } catch {
      $failures.Add($_)
      $failureStages.Add("Uninstall verification failed.")
    }

    if ($replacementWritten) {
      try {
        $remainingCommand = Get-ProtocolCommand
        if ($remainingCommand -ceq $replacementCommand) {
          Remove-Item -LiteralPath $protocolKey -Recurse -Force
        } elseif (Test-Path -LiteralPath $protocolKey) {
          throw "Protocol ownership changed unexpectedly; its registration was preserved."
        }
      } catch {
        $failures.Add($_)
        $failureStages.Add("Replacement-registration cleanup failed.")
      }
    }

    try {
      # Remove only this run's installation residue, after real uninstall has
      # removed the executable. Never clean AppData or an existing directory.
      if ((Test-Path -LiteralPath $Directory) -and -not (Test-Path -LiteralPath $app)) {
        Remove-Item -LiteralPath $Directory -Recurse -Force
      }
    } catch {
      $failures.Add($_)
      $failureStages.Add("Temporary-install cleanup failed.")
    }
  }

  # Cleanup must not replace the original validation error. Additional failures
  # are recorded as fixed stage labels in the public report.
  if ($failures.Count -gt 0) { throw $failures[0] }
  Assert-CleanTestAccount
}

$testRoot = $null
$testRootCreated = $false
$locationPushed = $false
$validationFailure = $null
$phase = "preflight"
$oldExecutable = $env:STAGE4D_EXECUTABLE
$oldExpectedVersion = $env:STAGE4D_EXPECTED_VERSION
try {
  # Replace any stale success from an earlier invocation before touching an
  # installer. An interrupted run must never leave a previous PASS artifact.
  Write-InstallReport -Success $false -Failure "Windows installer validation has not completed."
  if (-not $IsWindows) { throw "Run this check on Windows with PowerShell 7 in a clean test account/VM." }
  if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) { throw "Installer not found: $InstallerPath" }
  if (-not (Test-Path -LiteralPath $harness -PathType Leaf)) { throw "Public desktop harness not found: $harness" }
  $installer = (Resolve-Path -LiteralPath $InstallerPath).ProviderPath
  $node = (Get-Command node -CommandType Application -ErrorAction Stop).Source
  Assert-CleanTestAccount
  $checks.Add("No existing stage4d installation, process or URL protocol registration")

  $testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("stage4d public install check " + [guid]::NewGuid())
  if (Test-Path -LiteralPath $testRoot) { throw "Temporary test directory already exists: $testRoot" }
  $null = New-Item -ItemType Directory -Path $testRoot
  $testRootCreated = $true
  Push-Location -LiteralPath $harnessRoot
  $locationPushed = $true
  $phase = "primary installation cycle"
  Invoke-InstallationCycle -Directory (Join-Path $testRoot "Normal install") -TestDesktop
  $checks.Add("Silent install in a path with spaces, quoted HKCU protocol, packaged desktop validation and uninstall cleanup")
  $phase = "replacement-owner installation cycle"
  Invoke-InstallationCycle -Directory (Join-Path $testRoot "Ownership handoff install") -TestReplacementOwner
  $checks.Add("Uninstall preserves a replacement owner's protocol registration; synthetic registration removed")
} catch {
  $validationFailure = $_
  $failureStages.Add("Validation failed during $phase.")
} finally {
  try {
    $env:STAGE4D_EXECUTABLE = $oldExecutable
    $env:STAGE4D_EXPECTED_VERSION = $oldExpectedVersion
  } catch {
    if ($null -eq $validationFailure) { $validationFailure = $_ }
    $failureStages.Add("Process environment restoration failed.")
  }
  try {
    if ($locationPushed) { Pop-Location }
  } catch {
    if ($null -eq $validationFailure) { $validationFailure = $_ }
    $failureStages.Add("Working directory restoration failed.")
  }
  try {
    if ($testRootCreated -and (Test-Path -LiteralPath $testRoot)) {
      if (@(Get-ChildItem -LiteralPath $testRoot -Force).Count -eq 0) {
        Remove-Item -LiteralPath $testRoot
      } else {
        throw "Test installation files remain for inspection at $testRoot."
      }
    }
  } catch {
    if ($null -eq $validationFailure) { $validationFailure = $_ }
    $failureStages.Add("Temporary test-root cleanup failed; test files were retained.")
  }
}
if ($null -eq $validationFailure) {
  $checks.Add("Both installation cycles completed; temporary files removed and process environment restored")
}
try {
  Write-InstallReport -Success ($null -eq $validationFailure) -Failure ($failureStages -join " ")
} catch {
  if ($null -eq $validationFailure) { $validationFailure = $_ }
  Write-Warning "Windows installer report could not be written; validation must be treated as failed."
}
if ($null -ne $validationFailure) { throw $validationFailure }
Write-Output "PASS: NSIS install in a path with spaces, quoted HKCU protocol, packaged desktop checks, uninstall cleanup, and replacement-owner preservation."
