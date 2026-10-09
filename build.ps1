#Requires -Version 7
# Builds store-ready ZIPs in .\dist: one for the Chrome Web Store (also fine for Edge Add-ons)
# and one for Firefox Add-ons (AMO). The source manifest.json serves both browsers when loaded
# unpacked; each package gets a manifest stripped of the other browser's keys so the stores don't warn.
# Usage: pwsh ./build.ps1   (PowerShell 7; Windows PowerShell 5.1 mangles one-element arrays in ConvertTo-Json)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$root = $PSScriptRoot
$dist = Join-Path $root 'dist'
$files = @(
    'background.js', 'alert.html', 'alert.js', 'options.html', 'options.js', 'popup.html', 'popup.js', 'style.css',
    'lib/mqtt.min.js', 'icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png'
)

$manifestText = Get-Content (Join-Path $root 'manifest.json') -Raw
$version = ($manifestText | ConvertFrom-Json).version
New-Item -ItemType Directory -Force $dist | Out-Null

function New-Package([string]$target, [scriptblock]$editManifest) {
    $manifest = $manifestText | ConvertFrom-Json
    & $editManifest $manifest
    $zipPath = Join-Path $dist "mqtt-notifier-$target-$version.zip"
    if (Test-Path $zipPath) { Remove-Item $zipPath }

    # ZipFile with explicit entry names: Compress-Archive on Windows PowerShell writes backslashes,
    # which both stores reject.
    $zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
    try {
        $entry = $zip.CreateEntry('manifest.json')
        $writer = New-Object System.IO.StreamWriter($entry.Open(), (New-Object System.Text.UTF8Encoding($false)))
        $writer.Write(($manifest | ConvertTo-Json -Depth 10))
        $writer.Dispose()
        foreach ($file in $files) {
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $root $file), $file) | Out-Null
        }
    }
    finally {
        $zip.Dispose()
    }
    Write-Host "Built $zipPath"
}

New-Package 'chrome' {
    param($m)
    $m.background.PSObject.Properties.Remove('scripts')
    $m.PSObject.Properties.Remove('browser_specific_settings')
}

New-Package 'firefox' {
    param($m)
    $m.background.PSObject.Properties.Remove('service_worker')
    $m.permissions = @($m.permissions | Where-Object { $_ -ne 'system.display' })
}
