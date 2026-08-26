param(
  [string]$ExeName = "OXCode-Portable.exe",
  [string]$ShortcutName = "OX Code.lnk"
)
$root = Split-Path -Parent $PSScriptRoot
$exe = Get-ChildItem -Path (Join-Path $root "dist") -Filter $ExeName -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) { $exe = Get-ChildItem -Path (Join-Path $root "out") -Filter "*.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 }
if (-not $exe) { Write-Host "No exe found to create shortcut"; exit 0 }
$target = $exe.FullName
$desktop = [Environment]::GetFolderPath("Desktop")
$lnkPath = Join-Path $desktop $ShortcutName
$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut($lnkPath)
$sc.TargetPath = $target
$sc.WorkingDirectory = Split-Path $target -Parent
$sc.IconLocation = $target
$sc.Description = "OX Code - AI-powered Coding IDE"
$sc.Save()
Write-Host "Shortcut updated: $lnkPath -> $target"
