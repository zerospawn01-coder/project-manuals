[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$Root = "$HOME\work",
    [string]$ScratchName = "scratch",
    [ValidateSet("recommended", "minimal")]
    [string]$Layout = "recommended",
    [ValidateSet("keep", "archive", "delete")]
    [string]$ExcludedAction = "keep"
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
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

function Move-ArchiveItem {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param(
        [string]$SourcePath,
        [string]$DestinationPath,
        [string]$Label
    )

    if (-not (Test-Path -LiteralPath $SourcePath)) {
        Write-Warning "$Label source not found: $SourcePath"
        return
    }

    $destinationParent = Split-Path -Parent $DestinationPath
    if (-not [string]::IsNullOrWhiteSpace($destinationParent)) {
        Initialize-Directory -PathValue $destinationParent
    }

    if ($PSCmdlet.ShouldProcess($DestinationPath, "Move $Label from $SourcePath")) {
        Move-Item -LiteralPath $SourcePath -Destination $DestinationPath -Force
    }
}

$plan = & $planScript -Root $Root -ScratchName $ScratchName -Layout $Layout -AsJson | ConvertFrom-Json
$excludedEntries = @($plan.PlanEntries | Where-Object { $_.Disposition -eq "exclude" })
$reportFiles = @($plan.ReportFiles | Where-Object { $_.Disposition -ne "exclude" })

$scratchPath = $plan.ScratchPath
$reportsRoot = Join-Path $scratchPath "docs\reports"
$archiveRoot = Join-Path $scratchPath "docs\archive"
$excludedRoot = Join-Path $scratchPath "docs\excluded"

Write-Host "Executing archive plan in $Layout layout" -ForegroundColor Cyan
Write-Host "Scratch path    : $scratchPath"
Write-Host "Excluded action : $ExcludedAction"
Write-Host "Recommended final execution uses -ExcludedAction archive; keep is for review-only passes." -ForegroundColor DarkYellow
Write-Host ""

Initialize-Directory -PathValue $reportsRoot
Initialize-Directory -PathValue $archiveRoot

Write-Host "Report / archive candidates" -ForegroundColor Yellow
foreach ($item in $reportFiles) {
    $sourceRelative = Convert-RepoRelativePath -PathValue $item.Source
    $targetRelative = Convert-RepoRelativePath -PathValue $item.Target
    $sourcePath = Join-Path $scratchPath $sourceRelative
    $destinationPath = Join-Path (Join-Path $scratchPath $targetRelative) (Split-Path $sourceRelative -Leaf)

    Move-ArchiveItem -SourcePath $sourcePath -DestinationPath $destinationPath -Label "archive candidate"
    Write-Host ("  {0} -> {1}" -f $item.Source, $item.Target)
}

Write-Host ""
Write-Host "Excluded placeholder entries" -ForegroundColor Yellow
foreach ($entry in $excludedEntries) {
    $sourceRelative = Convert-RepoRelativePath -PathValue $entry.SourcePath
    $sourcePath = Join-Path $scratchPath $sourceRelative

    switch ($ExcludedAction) {
        "keep" {
            Write-Host ("  keep    {0} [{1}]" -f $entry.SourcePath, $entry.Notes)
        }
        "archive" {
            Initialize-Directory -PathValue $excludedRoot
            $destinationPath = Join-Path $excludedRoot (Split-Path $sourceRelative -Leaf)
            Move-ArchiveItem -SourcePath $sourcePath -DestinationPath $destinationPath -Label "excluded placeholder"
            Write-Host ("  archive {0} -> docs/excluded/ [{1}]" -f $entry.SourcePath, $entry.Notes)
        }
        "delete" {
            if (-not (Test-Path -LiteralPath $sourcePath)) {
                Write-Warning "Excluded placeholder source not found: $sourcePath"
                continue
            }

            if ($PSCmdlet.ShouldProcess($sourcePath, "Delete excluded placeholder")) {
                Remove-Item -LiteralPath $sourcePath -Recurse -Force
            }

            Write-Host ("  delete  {0} [{1}]" -f $entry.SourcePath, $entry.Notes)
        }
    }
}

Write-Host ""
Write-Host "Archive plan complete." -ForegroundColor Cyan
Write-Host "Use -WhatIf to preview moves or deletions before touching the scratch checkout."