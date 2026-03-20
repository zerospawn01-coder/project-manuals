[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$Root = "$HOME\work",
    [string]$ScratchName = "scratch",
    [ValidateSet("recommended", "minimal")]
    [string]$Layout = "recommended",
    [string]$TempRoot = $Root,
    [string]$Owner = "zerospawn01-coder",
    [ValidateSet("https", "ssh")]
    [string]$RemoteScheme = "https",
    [string]$RemoteBaseUrl,
    [switch]$Push
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$planScript = Join-Path $scriptDir "repo_split_plan.ps1"

function Invoke-NativeCommand {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param(
        [string]$WorkingDirectory,
        [string]$Executable,
        [string[]]$Arguments,
        [string]$ActionLabel
    )

    $argumentText = $Arguments -join ' '
    if (-not $PSCmdlet.ShouldProcess($WorkingDirectory, "$Executable $argumentText")) {
        return
    }

    Push-Location $WorkingDirectory
    try {
        & $Executable @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed during $ActionLabel with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
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

function Get-RemoteUrl {
    param(
        [string]$RepoName,
        [string]$OwnerName,
        [ValidateSet("https", "ssh")]
        [string]$Scheme,
        [string]$BaseUrl
    )

    if (-not [string]::IsNullOrWhiteSpace($BaseUrl)) {
        return (("{0}/{1}.git" -f $BaseUrl.TrimEnd('/'), $RepoName) -replace '(?<!:)/{2,}', '/')
    }

    if ($Scheme -eq "ssh") {
        return "git@github.com:{0}/{1}.git" -f $OwnerName, $RepoName
    }

    return "https://github.com/{0}/{1}.git" -f $OwnerName, $RepoName
}

$plan = & $planScript -Root $Root -ScratchName $ScratchName -Layout $Layout -AsJson | ConvertFrom-Json

$excludedEntries = @($plan.PlanEntries | Where-Object { $_.Disposition -eq "exclude" })

Write-Host "Executing filter-repo plan in $Layout layout" -ForegroundColor Cyan
Write-Host "Scratch path : $($plan.ScratchPath)"
Write-Host "Temp root    : $TempRoot"
Write-Host "Remote mode  : $RemoteScheme"
Write-Host "Push enabled : $Push"
Write-Host ""

if ($excludedEntries.Count -gt 0) {
    Write-Host "Excluded from execution:" -ForegroundColor DarkYellow
    foreach ($entry in $excludedEntries) {
        Write-Host ("  {0} [{1}]" -f $entry.SourcePath, $entry.Notes)
    }
    Write-Host ""
}

Initialize-Directory -PathValue $TempRoot

foreach ($repoPlan in $plan.Repositories) {
    if ($repoPlan.Method -ne "filter-repo" -or $repoPlan.Disposition -eq "exclude") {
        continue
    }

    $repoName = $repoPlan.Repo
    $workingCopy = Join-Path $TempRoot ("{0}-{1}-split" -f $ScratchName, $repoName)
    $remoteUrl = Get-RemoteUrl -RepoName $repoName -OwnerName $Owner -Scheme $RemoteScheme -BaseUrl $RemoteBaseUrl
    $filterItems = @($repoPlan.Items | Where-Object { $_.Disposition -ne "exclude" -and $_.MigrationMode -eq "filter-repo" })
    if ($filterItems.Count -eq 0) {
        Write-Warning "No filter-repo items remain for $repoName"
        Write-Host ""
        continue
    }

    if ($filterItems.Count -gt 1) {
        Write-Warning "Multiple filter-repo items found for $repoName; using the first item only."
    }

    $pathSpec = $filterItems[0].SourcePath.TrimEnd('/')

    Write-Host "[$repoName]" -ForegroundColor Yellow
    Write-Host "  filter path : $pathSpec/ [$($filterItems[0].Confidence)]"
    Write-Host "  temp clone  : $workingCopy"
    Write-Host "  remote url  : $remoteUrl"

    if (Test-Path -LiteralPath $workingCopy) {
        Write-Warning "Temporary clone already exists: $workingCopy"
        Write-Warning "Remove it or choose a different TempRoot before executing without -WhatIf."
        Write-Host ""
        continue
    }

    Invoke-NativeCommand -WorkingDirectory $TempRoot -Executable "git" -Arguments @("clone", $plan.ScratchPath, $workingCopy) -ActionLabel "temporary clone"
    Invoke-NativeCommand -WorkingDirectory $workingCopy -Executable "git" -Arguments @("filter-repo", "--path", "$pathSpec/", "--path-rename", "$pathSpec/:", "--force") -ActionLabel "filter-repo"
    Invoke-NativeCommand -WorkingDirectory $workingCopy -Executable "git" -Arguments @("remote", "remove", "origin") -ActionLabel "remove origin"
    Invoke-NativeCommand -WorkingDirectory $workingCopy -Executable "git" -Arguments @("remote", "add", "origin", $remoteUrl) -ActionLabel "add origin"
    Invoke-NativeCommand -WorkingDirectory $workingCopy -Executable "git" -Arguments @("branch", "-M", "main") -ActionLabel "rename branch"

    if ($Push) {
        Invoke-NativeCommand -WorkingDirectory $workingCopy -Executable "git" -Arguments @("push", "-u", "origin", "main") -ActionLabel "push"
    } else {
        Write-Host "  push skipped; use -Push after validating the filtered clone." -ForegroundColor DarkYellow
    }

    Write-Host ""
}

Write-Host "Filter-repo plan complete." -ForegroundColor Cyan
Write-Host "Use -WhatIf for preview and enable -Push only after checking the temporary clones. HTTPS is the default remote mode in this environment."