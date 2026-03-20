[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$Root,
    [string]$ScratchName,
    [ValidateSet("recommended", "minimal")]
    [string]$Layout = "recommended",
    [string]$DestinationRoot
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspaceRoot = Split-Path -Parent $scriptDir
$detectedScratchPath = Split-Path -Parent $workspaceRoot
$detectedRoot = Split-Path -Parent $detectedScratchPath

if ([string]::IsNullOrWhiteSpace($Root)) {
    $Root = $detectedRoot
}

if ([string]::IsNullOrWhiteSpace($ScratchName)) {
    $ScratchName = Split-Path -Leaf $detectedScratchPath
}

if ([string]::IsNullOrWhiteSpace($DestinationRoot)) {
    $DestinationRoot = $Root
}

$planScript = Join-Path $scriptDir "repo_split_plan.ps1"

function Convert-RepoRelativePath {
    param([string]$PathValue)

    if ([string]::IsNullOrWhiteSpace($PathValue) -or $PathValue -eq "/") {
        return ""
    }

    return ($PathValue.Trim("/") -replace '/', '\')
}

function Initialize-Directory {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param([string]$PathValue)

    if (-not (Test-Path -LiteralPath $PathValue)) {
        if ($PSCmdlet.ShouldProcess($PathValue, "Create directory")) {
            New-Item -ItemType Directory -Path $PathValue -Force | Out-Null
        }
    }
}

function Test-CopyPreflight {
    param([object]$Plan)

    if (-not (Test-Path -LiteralPath $Plan.ScratchPath)) {
        throw "Scratch path not found: $($Plan.ScratchPath). Run against a full scratch checkout or pass -Root/-ScratchName explicitly."
    }

    $missingSources = @()
    foreach ($repoPlan in $Plan.Repositories) {
        if ($repoPlan.Method -ne "copy" -or $repoPlan.Disposition -eq "exclude") {
            continue
        }

        foreach ($item in $repoPlan.Items) {
            if ($item.Disposition -eq "exclude" -or $item.MigrationMode -ne "copy") {
                continue
            }

            $sourceRelative = Convert-RepoRelativePath -PathValue $item.SourcePath
            $sourcePath = Join-Path $Plan.ScratchPath $sourceRelative
            if (-not (Test-Path -LiteralPath $sourcePath)) {
                $missingSources += [pscustomobject]@{
                    SourcePath = $item.SourcePath
                    ResolvedPath = $sourcePath
                    TargetRepo = $repoPlan.Repo
                    TargetPath = $item.TargetPath
                }
            }
        }
    }

    if ($missingSources.Count -gt 0) {
        Write-Error "Copy preflight failed. Missing required source paths:"
        foreach ($missing in $missingSources) {
            Write-Error ("  {0} -> {1}/{2} (resolved: {3})" -f $missing.SourcePath, $missing.TargetRepo, $missing.TargetPath, $missing.ResolvedPath)
        }
        throw "Copy aborted before writing because one or more required source paths were missing."
    }
}

$plan = & $planScript -Root $Root -ScratchName $ScratchName -Layout $Layout -AsJson | ConvertFrom-Json
Test-CopyPreflight -Plan $plan

$excludedEntries = @($plan.PlanEntries | Where-Object { $_.Disposition -eq "exclude" })

Write-Host "Executing copy plan in $Layout layout" -ForegroundColor Cyan
Write-Host "Scratch path      : $($plan.ScratchPath)"
Write-Host "Destination root  : $DestinationRoot"
Write-Host ""

if ($excludedEntries.Count -gt 0) {
    Write-Host "Excluded from execution:" -ForegroundColor DarkYellow
    foreach ($entry in $excludedEntries) {
        Write-Host ("  {0} [{1}]" -f $entry.SourcePath, $entry.Notes)
    }
    Write-Host ""
}

foreach ($repoPlan in $plan.Repositories) {
    if ($repoPlan.Method -ne "copy" -or $repoPlan.Disposition -eq "exclude") {
        continue
    }

    $repoPath = Join-Path $DestinationRoot $repoPlan.Repo
    Initialize-Directory -PathValue $repoPath
    Write-Host "[$($repoPlan.Repo)]" -ForegroundColor Yellow

    foreach ($item in $repoPlan.Items) {
        if ($item.Disposition -eq "exclude" -or $item.MigrationMode -ne "copy") {
            continue
        }

        $sourceRelative = Convert-RepoRelativePath -PathValue $item.SourcePath
        $targetRelative = Convert-RepoRelativePath -PathValue $item.TargetPath
        $sourcePath = Join-Path $plan.ScratchPath $sourceRelative

        $sourceItem = Get-Item -LiteralPath $sourcePath
        $targetPath = if ([string]::IsNullOrWhiteSpace($targetRelative)) {
            $repoPath
        } else {
            Join-Path $repoPath $targetRelative
        }

        if ($sourceItem.PSIsContainer) {
            if ([string]::IsNullOrWhiteSpace($targetRelative)) {
                Initialize-Directory -PathValue $repoPath
                $copySource = Join-Path $sourcePath '*'
                if ($PSCmdlet.ShouldProcess($repoPath, "Copy directory contents from $sourcePath")) {
                    Copy-Item -Path $copySource -Destination $repoPath -Recurse -Force
                }
            } else {
                Initialize-Directory -PathValue $targetPath
                $copySource = Join-Path $sourcePath '*'
                if ($PSCmdlet.ShouldProcess($targetPath, "Copy directory contents from $sourcePath")) {
                    Copy-Item -Path $copySource -Destination $targetPath -Recurse -Force
                }
            }
        } else {
            $targetParent = Split-Path -Parent $targetPath
            if (-not [string]::IsNullOrWhiteSpace($targetParent)) {
                Initialize-Directory -PathValue $targetParent
            }

            if ($PSCmdlet.ShouldProcess($targetPath, "Copy file from $sourcePath")) {
                Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force
            }
        }

        Write-Host ("  {0} -> {1} [{2}]" -f $item.SourcePath, $item.TargetPath, $item.Confidence)
    }

    Write-Host ""
}

Write-Host "Copy plan complete." -ForegroundColor Cyan
Write-Host "Use -WhatIf to preview without writing and omit it only after validating against a full scratch checkout."