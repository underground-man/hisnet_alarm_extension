param(
    [switch]$VerifyOnly
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$DistDir = Join-Path $ProjectRoot "dist"
$ZipPath = Join-Path $DistDir "hisnet_notifier.zip"
$RuntimeFiles = @(
    "background.js",
    "core.js",
    "manifest.json",
    "options.html",
    "options.js",
    "popup.html",
    "popup.js",
    "ui-actions.js",
    "icons\icon16.png",
    "icons\icon48.png",
    "icons\icon128.png"
)

function Get-Sha256Hex([string]$LiteralPath) {
    $Stream = [IO.File]::OpenRead($LiteralPath)
    try {
        $Sha256 = [Security.Cryptography.SHA256]::Create()
        try {
            return ([BitConverter]::ToString($Sha256.ComputeHash($Stream))).Replace("-", "")
        }
        finally {
            $Sha256.Dispose()
        }
    }
    finally {
        $Stream.Dispose()
    }
}

function Test-ReleaseZip {
    if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) {
        throw "Release ZIP does not exist: $ZipPath"
    }

    $TempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $VerifyDir = Join-Path $TempRoot ("hisnet_verify_" + [guid]::NewGuid().ToString("N"))
    $ResolvedVerifyDir = [IO.Path]::GetFullPath($VerifyDir)
    if (-not $ResolvedVerifyDir.StartsWith($TempRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe verification directory: $ResolvedVerifyDir"
    }

    try {
        Expand-Archive -LiteralPath $ZipPath -DestinationPath $ResolvedVerifyDir
        $PackageRoot = Join-Path $ResolvedVerifyDir "hisnet_notifier"
        $ActualFiles = Get-ChildItem -LiteralPath $PackageRoot -File -Recurse | ForEach-Object {
            $_.FullName.Substring($PackageRoot.Length + 1)
        } | Sort-Object
        $ExpectedFiles = $RuntimeFiles | Sort-Object

        if (Compare-Object -ReferenceObject $ExpectedFiles -DifferenceObject $ActualFiles) {
            throw "Release ZIP file list does not match the runtime file list."
        }

        foreach ($RelativePath in $RuntimeFiles) {
            $SourcePath = Join-Path $ProjectRoot $RelativePath
            $ArchivedPath = Join-Path $PackageRoot $RelativePath
            $SourceHash = Get-Sha256Hex $SourcePath
            $ArchivedHash = Get-Sha256Hex $ArchivedPath
            if ($SourceHash -ne $ArchivedHash) {
                throw "Release ZIP is stale: $RelativePath"
            }
        }
    }
    finally {
        if (Test-Path -LiteralPath $ResolvedVerifyDir) {
            Remove-Item -LiteralPath $ResolvedVerifyDir -Recurse -Force
        }
    }

    Write-Output "Release ZIP verified: $ZipPath"
}

if ($VerifyOnly) {
    Test-ReleaseZip
    exit 0
}

New-Item -ItemType Directory -Path $DistDir -Force | Out-Null
$TempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$StageDir = Join-Path $TempRoot ("hisnet_package_" + [guid]::NewGuid().ToString("N"))
$ResolvedStageDir = [IO.Path]::GetFullPath($StageDir)
if (-not $ResolvedStageDir.StartsWith($TempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe staging directory: $ResolvedStageDir"
}

try {
    $PackageDir = Join-Path $ResolvedStageDir "hisnet_notifier"
    New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null
    foreach ($RelativePath in $RuntimeFiles) {
        $SourcePath = Join-Path $ProjectRoot $RelativePath
        $DestinationPath = Join-Path $PackageDir $RelativePath
        New-Item -ItemType Directory -Path (Split-Path $DestinationPath) -Force | Out-Null
        Copy-Item -LiteralPath $SourcePath -Destination $DestinationPath
    }

    if (Test-Path -LiteralPath $ZipPath) {
        Remove-Item -LiteralPath $ZipPath -Force
    }
    Compress-Archive -LiteralPath $PackageDir -DestinationPath $ZipPath -CompressionLevel Optimal
}
finally {
    if (Test-Path -LiteralPath $ResolvedStageDir) {
        Remove-Item -LiteralPath $ResolvedStageDir -Recurse -Force
    }
}

Test-ReleaseZip
