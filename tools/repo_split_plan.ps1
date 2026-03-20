param(
    [string]$Root,
    [string]$ScratchName,
    [ValidateSet("recommended", "minimal")]
    [string]$Layout = "recommended",
    [switch]$AsJson
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

function New-PlanItem {
    param(
        [string]$SourcePath,
        [string]$Category,
        [string]$TargetRepo,
        [string]$TargetPath,
        [ValidateSet("copy", "filter-repo", "exclude")]
        [string]$MigrationMode,
        [ValidateSet("confirmed", "provisional")]
        [string]$Confidence,
        [ValidateSet("include", "exclude")]
        [string]$Disposition = "include",
        [string]$Notes = ""
    )

    [pscustomobject]@{
        Source = $SourcePath
        Target = $TargetPath
        SourcePath = $SourcePath
        Category = $Category
        TargetRepo = $TargetRepo
        TargetPath = $TargetPath
        MigrationMode = $MigrationMode
        Confidence = $Confidence
        Disposition = $Disposition
        Notes = $Notes
    }
}

function New-RepoPlan {
    param(
        [string]$Repo,
        [string]$Category,
        [ValidateSet("copy", "filter-repo", "exclude")]
        [string]$MigrationMode,
        [bool]$PreserveHistory,
        [ValidateSet("confirmed", "provisional")]
        [string]$Confidence,
        [ValidateSet("include", "exclude")]
        [string]$Disposition,
        [string]$Notes,
        [object[]]$Items
    )

    [pscustomobject]@{
        Repo = $Repo
        Category = $Category
        Method = $MigrationMode
        MigrationMode = $MigrationMode
        PreserveHistory = $PreserveHistory
        Confidence = $Confidence
        Disposition = $Disposition
        Notes = $Notes
        Items = $Items
    }
}

function Get-RecommendedPlanEntries {
    @(
        New-PlanItem -SourcePath ".github/" -Category "core" -TargetRepo "cognitive-lab" -TargetPath ".github/" -MigrationMode "copy" -Confidence "confirmed" -Notes "Retain active CI definitions with the core repository."
        New-PlanItem -SourcePath "post_alignment_lab/" -Category "core" -TargetRepo "cognitive-lab" -TargetPath "post_alignment_lab/" -MigrationMode "copy" -Confidence "confirmed" -Notes "Active core component."
        New-PlanItem -SourcePath "intuition-layer/" -Category "core" -TargetRepo "cognitive-lab" -TargetPath "intuition-layer/" -MigrationMode "copy" -Confidence "confirmed" -Notes "Active core component."
        New-PlanItem -SourcePath "analyze_leap.py" -Category "core" -TargetRepo "cognitive-lab" -TargetPath "leap_analysis/analyze_leap.py" -MigrationMode "copy" -Confidence "confirmed" -Notes "LEAP analysis root file."
        New-PlanItem -SourcePath "run_leap_analysis.py" -Category "core" -TargetRepo "cognitive-lab" -TargetPath "leap_analysis/run_leap_analysis.py" -MigrationMode "copy" -Confidence "confirmed" -Notes "LEAP analysis root file."
        New-PlanItem -SourcePath "leap_analysis_core.py" -Category "core" -TargetRepo "cognitive-lab" -TargetPath "leap_analysis/leap_analysis_core.py" -MigrationMode "copy" -Confidence "confirmed" -Notes "LEAP analysis root file."
        New-PlanItem -SourcePath "test_leap_analysis.py" -Category "core" -TargetRepo "cognitive-lab" -TargetPath "leap_analysis/test_leap_analysis.py" -MigrationMode "copy" -Confidence "confirmed" -Notes "LEAP analysis test file."
        New-PlanItem -SourcePath "LEAP_ANALYSIS_README.md" -Category "core" -TargetRepo "cognitive-lab" -TargetPath "leap_analysis/README.md" -MigrationMode "copy" -Confidence "confirmed" -Notes "Normalize README name under LEAP directory."
        New-PlanItem -SourcePath "CI_CD_SETUP.md" -Category "core" -TargetRepo "cognitive-lab" -TargetPath "CI_CD_SETUP.md" -MigrationMode "copy" -Confidence "confirmed" -Notes "Keep CI setup guidance with the active core repository."

        New-PlanItem -SourcePath "ea-aol/" -Category "independent" -TargetRepo "ea-aol" -TargetPath "/" -MigrationMode "filter-repo" -Confidence "confirmed" -Notes "Preserve history."
        New-PlanItem -SourcePath "mtp_weaver/" -Category "independent" -TargetRepo "mtp-weaver" -TargetPath "/" -MigrationMode "filter-repo" -Confidence "confirmed" -Notes "Preserve history."

        New-PlanItem -SourcePath "jepa_intuition_poc/" -Category "experiment" -TargetRepo "lab-experiments" -TargetPath "jepa_intuition_poc/" -MigrationMode "copy" -Confidence "confirmed" -Notes "Optimized 5-repo layout groups POC work into lab-experiments."
        New-PlanItem -SourcePath "geodesic_descent/" -Category "experiment" -TargetRepo "lab-experiments" -TargetPath "geodesic_descent/" -MigrationMode "copy" -Confidence "confirmed" -Notes "Optimized 5-repo layout groups experiments into lab-experiments."
        New-PlanItem -SourcePath "personal_ai/" -Category "support" -TargetRepo "lab-experiments" -TargetPath "personal_ai/" -MigrationMode "copy" -Confidence "confirmed" -Notes "Optimized 5-repo layout keeps personal exploratory work in lab-experiments."
        New-PlanItem -SourcePath "project_manuals/" -Category "support" -TargetRepo "project-manuals" -TargetPath "/" -MigrationMode "copy" -Confidence "confirmed" -Notes "Docs-only repository candidate."

        New-PlanItem -SourcePath "aesthetic-resonator/" -Category "deferred" -TargetRepo "" -TargetPath "" -MigrationMode "exclude" -Confidence "confirmed" -Disposition "exclude" -Notes "Deferred after the optimized 5-repo migration; not on the current CI-backed critical path."
        New-PlanItem -SourcePath "AI-Browser-Core/" -Category "deferred" -TargetRepo "" -TargetPath "" -MigrationMode "exclude" -Confidence "confirmed" -Disposition "exclude" -Notes "Deferred after the optimized 5-repo migration; revisit if it graduates from scratch later."
        New-PlanItem -SourcePath "autonomous-task-gen/" -Category "deferred" -TargetRepo "" -TargetPath "" -MigrationMode "exclude" -Confidence "confirmed" -Disposition "exclude" -Notes "Deferred after the optimized 5-repo migration; not part of the active CI core."
        New-PlanItem -SourcePath "clean-room-v1.0.0/" -Category "deferred" -TargetRepo "" -TargetPath "" -MigrationMode "exclude" -Confidence "confirmed" -Disposition "exclude" -Notes "Deferred packaged snapshot outside the optimized 5-repo scope."
        New-PlanItem -SourcePath "live_agents/" -Category "deferred" -TargetRepo "" -TargetPath "" -MigrationMode "exclude" -Confidence "confirmed" -Disposition "exclude" -Notes "Deferred after the optimized 5-repo migration; current contents are mostly generated artifacts."
        New-PlanItem -SourcePath "mvp_halt/" -Category "deferred" -TargetRepo "" -TargetPath "" -MigrationMode "exclude" -Confidence "confirmed" -Disposition "exclude" -Notes "Deferred after the optimized 5-repo migration; current contents are not maintained source."
        New-PlanItem -SourcePath "Antigravity-Forge/" -Category "deferred" -TargetRepo "" -TargetPath "" -MigrationMode "exclude" -Confidence "confirmed" -Disposition "exclude" -Notes "Deferred after the optimized 5-repo migration to avoid repo sprawl in phase 1."
        New-PlanItem -SourcePath "cognitive-substrate/" -Category "deferred" -TargetRepo "" -TargetPath "" -MigrationMode "exclude" -Confidence "confirmed" -Disposition "exclude" -Notes "Deferred after the optimized 5-repo migration to keep the split centered on active CI domains."
        New-PlanItem -SourcePath "sovereign-arena-chaos/" -Category "deferred" -TargetRepo "" -TargetPath "" -MigrationMode "exclude" -Confidence "confirmed" -Disposition "exclude" -Notes "Deferred after the optimized 5-repo migration; revisit in a later split phase."

        New-PlanItem -SourcePath "antigravity_dashboard/" -Category "archive-placeholder" -TargetRepo "" -TargetPath "" -MigrationMode "exclude" -Confidence "provisional" -Disposition "exclude" -Notes "Only __pycache__ present at root."
        New-PlanItem -SourcePath "system_sentinel/" -Category "archive-placeholder" -TargetRepo "" -TargetPath "" -MigrationMode "exclude" -Confidence "provisional" -Disposition "exclude" -Notes "Directory currently empty."
        New-PlanItem -SourcePath "tts_narrator/" -Category "archive-placeholder" -TargetRepo "" -TargetPath "" -MigrationMode "exclude" -Confidence "provisional" -Disposition "exclude" -Notes "Only __pycache__ present at root."
    )
}

function Get-MinimalPlanEntries {
    @(
        New-PlanItem -SourcePath ".github/" -Category "core" -TargetRepo "cognitive-lab" -TargetPath ".github/" -MigrationMode "copy" -Confidence "confirmed" -Notes "Retain active CI definitions with the core repository in minimal layout."
        New-PlanItem -SourcePath "post_alignment_lab/" -Category "core" -TargetRepo "cognitive-lab" -TargetPath "post_alignment_lab/" -MigrationMode "copy" -Confidence "confirmed" -Notes "Active core component."
        New-PlanItem -SourcePath "intuition-layer/" -Category "core" -TargetRepo "cognitive-lab" -TargetPath "intuition-layer/" -MigrationMode "copy" -Confidence "confirmed" -Notes "Active core component."
        New-PlanItem -SourcePath "analyze_leap.py" -Category "core" -TargetRepo "cognitive-lab" -TargetPath "leap_analysis/analyze_leap.py" -MigrationMode "copy" -Confidence "confirmed" -Notes "LEAP analysis root file."
        New-PlanItem -SourcePath "run_leap_analysis.py" -Category "core" -TargetRepo "cognitive-lab" -TargetPath "leap_analysis/run_leap_analysis.py" -MigrationMode "copy" -Confidence "confirmed" -Notes "LEAP analysis root file."
        New-PlanItem -SourcePath "leap_analysis_core.py" -Category "core" -TargetRepo "cognitive-lab" -TargetPath "leap_analysis/leap_analysis_core.py" -MigrationMode "copy" -Confidence "confirmed" -Notes "LEAP analysis root file."
        New-PlanItem -SourcePath "test_leap_analysis.py" -Category "core" -TargetRepo "cognitive-lab" -TargetPath "leap_analysis/test_leap_analysis.py" -MigrationMode "copy" -Confidence "confirmed" -Notes "LEAP analysis test file."
        New-PlanItem -SourcePath "LEAP_ANALYSIS_README.md" -Category "core" -TargetRepo "cognitive-lab" -TargetPath "leap_analysis/README.md" -MigrationMode "copy" -Confidence "confirmed" -Notes "Normalize README name under LEAP directory."
        New-PlanItem -SourcePath "CI_CD_SETUP.md" -Category "core" -TargetRepo "cognitive-lab" -TargetPath "CI_CD_SETUP.md" -MigrationMode "copy" -Confidence "confirmed" -Notes "Keep CI setup guidance with the core repository in minimal layout."
        New-PlanItem -SourcePath "project_manuals/" -Category "support" -TargetRepo "cognitive-lab" -TargetPath "docs/manuals/" -MigrationMode "copy" -Confidence "confirmed" -Notes "Confirmed minimal-layout compression: fold manuals into cognitive-lab/docs/manuals."

        New-PlanItem -SourcePath "ea-aol/" -Category "independent" -TargetRepo "ea-aol" -TargetPath "/" -MigrationMode "filter-repo" -Confidence "confirmed" -Notes "Preserve history."
        New-PlanItem -SourcePath "mtp_weaver/" -Category "independent" -TargetRepo "mtp-weaver" -TargetPath "/" -MigrationMode "filter-repo" -Confidence "confirmed" -Notes "Preserve history."

        New-PlanItem -SourcePath "jepa_intuition_poc/" -Category "experiment" -TargetRepo "lab-experiments" -TargetPath "jepa_intuition_poc/" -MigrationMode "copy" -Confidence "confirmed" -Notes "Minimal layout groups experiments."
        New-PlanItem -SourcePath "geodesic_descent/" -Category "experiment" -TargetRepo "lab-experiments" -TargetPath "geodesic_descent/" -MigrationMode "copy" -Confidence "confirmed" -Notes "Minimal layout groups experiments."
        New-PlanItem -SourcePath "personal_ai/" -Category "support" -TargetRepo "lab-experiments" -TargetPath "personal_ai/" -MigrationMode "copy" -Confidence "confirmed" -Notes "Minimal layout groups personal work."
        New-PlanItem -SourcePath "aesthetic-resonator/" -Category "deferred" -TargetRepo "" -TargetPath "" -MigrationMode "exclude" -Confidence "confirmed" -Disposition "exclude" -Notes "Deferred after the optimized 4-repo fallback migration."
        New-PlanItem -SourcePath "AI-Browser-Core/" -Category "deferred" -TargetRepo "" -TargetPath "" -MigrationMode "exclude" -Confidence "confirmed" -Disposition "exclude" -Notes "Deferred after the optimized 4-repo fallback migration."
        New-PlanItem -SourcePath "autonomous-task-gen/" -Category "deferred" -TargetRepo "" -TargetPath "" -MigrationMode "exclude" -Confidence "confirmed" -Disposition "exclude" -Notes "Deferred after the optimized 4-repo fallback migration."
        New-PlanItem -SourcePath "clean-room-v1.0.0/" -Category "deferred" -TargetRepo "" -TargetPath "" -MigrationMode "exclude" -Confidence "confirmed" -Disposition "exclude" -Notes "Deferred after the optimized 4-repo fallback migration."
        New-PlanItem -SourcePath "live_agents/" -Category "deferred" -TargetRepo "" -TargetPath "" -MigrationMode "exclude" -Confidence "confirmed" -Disposition "exclude" -Notes "Deferred after the optimized 4-repo fallback migration."
        New-PlanItem -SourcePath "mvp_halt/" -Category "deferred" -TargetRepo "" -TargetPath "" -MigrationMode "exclude" -Confidence "confirmed" -Disposition "exclude" -Notes "Deferred after the optimized 4-repo fallback migration."
        New-PlanItem -SourcePath "Antigravity-Forge/" -Category "deferred" -TargetRepo "" -TargetPath "" -MigrationMode "exclude" -Confidence "confirmed" -Disposition "exclude" -Notes "Deferred after the optimized 4-repo fallback migration."
        New-PlanItem -SourcePath "cognitive-substrate/" -Category "deferred" -TargetRepo "" -TargetPath "" -MigrationMode "exclude" -Confidence "confirmed" -Disposition "exclude" -Notes "Deferred after the optimized 4-repo fallback migration."
        New-PlanItem -SourcePath "sovereign-arena-chaos/" -Category "deferred" -TargetRepo "" -TargetPath "" -MigrationMode "exclude" -Confidence "confirmed" -Disposition "exclude" -Notes "Deferred after the optimized 4-repo fallback migration."

        New-PlanItem -SourcePath "antigravity_dashboard/" -Category "archive-placeholder" -TargetRepo "" -TargetPath "" -MigrationMode "exclude" -Confidence "provisional" -Disposition "exclude" -Notes "Only __pycache__ present at root."
        New-PlanItem -SourcePath "system_sentinel/" -Category "archive-placeholder" -TargetRepo "" -TargetPath "" -MigrationMode "exclude" -Confidence "provisional" -Disposition "exclude" -Notes "Directory currently empty."
        New-PlanItem -SourcePath "tts_narrator/" -Category "archive-placeholder" -TargetRepo "" -TargetPath "" -MigrationMode "exclude" -Confidence "provisional" -Disposition "exclude" -Notes "Only __pycache__ present at root."
    )
}

function Group-PlanEntries {
    param([object[]]$Entries)

    $includeEntries = $Entries | Where-Object { $_.Disposition -ne "exclude" }
    $groups = $includeEntries | Group-Object TargetRepo, MigrationMode
    $repoPlans = foreach ($group in $groups) {
        $items = @($group.Group)
        $first = $items[0]
        $preserveHistory = $first.MigrationMode -eq "filter-repo"
        $confidence = if (($items.Confidence | Sort-Object -Unique) -contains "provisional") { "provisional" } else { "confirmed" }
        New-RepoPlan -Repo $first.TargetRepo -Category $first.Category -MigrationMode $first.MigrationMode -PreserveHistory $preserveHistory -Confidence $confidence -Disposition "include" -Notes "" -Items $items
    }

    $excludeItems = @($Entries | Where-Object { $_.Disposition -eq "exclude" })
    if ($excludeItems.Count -gt 0) {
        $repoPlans += New-RepoPlan -Repo "excluded" -Category "archive-placeholder" -MigrationMode "exclude" -PreserveHistory $false -Confidence "provisional" -Disposition "exclude" -Notes "Items intentionally excluded from split execution." -Items $excludeItems
    }

    $repoPlans
}

$scratchPath = Join-Path $Root $ScratchName
$planEntries = if ($Layout -eq "recommended") { Get-RecommendedPlanEntries } else { Get-MinimalPlanEntries }
$repoPlans = Group-PlanEntries -Entries $planEntries

$reportFiles = @(
    [pscustomobject]@{ Source = "CODE_QUALITY_REVIEW.md"; Target = "docs/reports/"; MigrationMode = "copy"; Confidence = "confirmed"; Disposition = "include" },
    [pscustomobject]@{ Source = "CRITICAL_EVALUATION_REPORT.md"; Target = "docs/reports/"; MigrationMode = "copy"; Confidence = "confirmed"; Disposition = "include" },
    [pscustomobject]@{ Source = "FINAL_UNIT_TEST_REPORT.md"; Target = "docs/reports/"; MigrationMode = "copy"; Confidence = "confirmed"; Disposition = "include" },
    [pscustomobject]@{ Source = "FINAL_WORK_SUMMARY.md"; Target = "docs/archive/"; MigrationMode = "copy"; Confidence = "confirmed"; Disposition = "include" },
    [pscustomobject]@{ Source = "TODAY_WORK_SUMMARY.md"; Target = "docs/archive/"; MigrationMode = "copy"; Confidence = "confirmed"; Disposition = "include" },
    [pscustomobject]@{ Source = "UNIT_TEST_IMPLEMENTATION_REPORT.md"; Target = "docs/reports/"; MigrationMode = "copy"; Confidence = "confirmed"; Disposition = "include" },
    [pscustomobject]@{ Source = "PUBLICATION_READINESS_REPORT.md"; Target = "docs/reports/"; MigrationMode = "copy"; Confidence = "confirmed"; Disposition = "include" }
)

$plan = [pscustomobject]@{
    GeneratedAt = (Get-Date).ToString("s")
    Layout = $Layout
    Root = $Root
    ScratchPath = $scratchPath
    Repositories = $repoPlans
    PlanEntries = $planEntries
    ReportFiles = $reportFiles
    Preconditions = @(
        "Run against a full scratch checkout, not the current project_manuals-focused workspace.",
        "Checkpoint or tag scratch before any split.",
        "Create empty destination repositories before execution.",
        "Use temporary clones for filter-repo operations.",
        "Treat excluded placeholders as review-required before real execution."
    )
}

if ($AsJson) {
    $plan | ConvertTo-Json -Depth 8
    return
}

Write-Host "Repository Split Plan" -ForegroundColor Cyan
Write-Host "Layout       : $Layout"
Write-Host "Root         : $Root"
Write-Host "Scratch path : $scratchPath"
Write-Host ""

foreach ($repoPlan in ($repoPlans | Where-Object { $_.Disposition -ne "exclude" })) {
    $historyText = if ($repoPlan.PreserveHistory) { "preserve-history" } else { $repoPlan.MigrationMode }
    Write-Host ("[{0}] {1} ({2}, {3})" -f $repoPlan.Repo, $repoPlan.Category, $historyText, $repoPlan.Confidence) -ForegroundColor Yellow
    foreach ($item in $repoPlan.Items) {
        Write-Host ("  {0} -> {1} [{2}, {3}]" -f $item.SourcePath, $item.TargetPath, $item.MigrationMode, $item.Confidence)
    }
    Write-Host ""
}

$excludedEntries = @($planEntries | Where-Object { $_.Disposition -eq "exclude" })
if ($excludedEntries.Count -gt 0) {
    Write-Host "Excluded entries" -ForegroundColor Cyan
    foreach ($item in $excludedEntries) {
        Write-Host ("  {0} [{1}]" -f $item.SourcePath, $item.Notes)
    }
    Write-Host ""
}

Write-Host "Report / archive candidates" -ForegroundColor Cyan
foreach ($file in $reportFiles) {
    Write-Host ("  {0} -> {1}" -f $file.Source, $file.Target)
}

Write-Host ""
Write-Host "Suggested next actions" -ForegroundColor Cyan
Write-Host "  1. Review excluded placeholder entries before any real execution."
Write-Host "  2. Create empty destination repositories for the current 5-repo or 4-repo target set."
Write-Host "  3. Use -WhatIf on copy and filter-repo scripts before any write."
Write-Host "  4. Keep excluded entries out of execution until explicitly reclassified."