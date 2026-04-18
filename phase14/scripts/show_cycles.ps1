$dirs = @("202604071446349","202604071601261","202604071601366","202604071601434","202604071601542")
foreach ($d in $dirs) {
    $mf = Get-ChildItem "phase14\data\live_fire_runs\$d\morning" -Filter "morning_result_*.json" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($mf) {
        $j = Get-Content $mf.FullName | ConvertFrom-Json
        $cid = if ($j.cycle_id) { $j.cycle_id.Substring(0,8) } else { "n/a" }
        $drift = if ($j.display.drift_status) { $j.display.drift_status } else { "null" }
        $cum = $j.evolution.cumulative_promoted_skill_count
        Write-Host "[$d]  cycle:$cid  stability:$($j.metrics.stability_index.score)  saved_min:$($j.metrics.saved_time_minutes.total)  promoted:$($j.evolution.promoted_skill_count)(cum:$cum)  blocked:$($j.guardian.blocked_risky_actions.count)  posture:$($j.guardian.security_posture)  anim:$($j.display.animation)  drift:$drift"
    } else {
        Write-Host "[$d]  no morning result found"
    }
}
