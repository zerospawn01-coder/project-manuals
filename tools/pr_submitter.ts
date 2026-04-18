/**
 * tools/pr_submitter.ts
 *
 * PR Submitter — "PROMOTED → git branch → PR"
 *
 * Design principle: "promotion = PR作成"
 * When Phase C marks a patch as PROMOTED, this module proposes the change
 * as a GitHub Draft PR for human review — instead of silently logging it.
 *
 * Flow for each PROMOTED skill:
 *   1. git checkout -b  auto/promote/{cycle_short}/{skill_short}
 *   2. git apply        (apply the unified diff from VerifiedPatch)
 *   3. git commit
 *   4. git push origin <branch>
 *   5. POST /repos/{owner}/{repo}/pulls  (Draft PR)
 *   6. Return to original branch
 *
 * Requires:
 *   GITHUB_TOKEN in process.env (or PRSubmitterConfig.github_token)
 *   git in PATH
 *
 * Safe-fail design:
 *   If any step fails for a specific skill, that skill is recorded as
 *   'failed' and the loop continues for remaining skills.
 *   The working directory is always restored to its original branch.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import type { PromotingGateResult } from '../contract/phase_c_promote';
import type { PhaseBBatchResult } from '../contract/phase_b_verify';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PRSubmitterConfig {
  /** GitHub repo owner, e.g. "zerospawn01-coder" */
  repo_owner: string;
  /** GitHub repo name, e.g. "project-manuals" */
  repo_name: string;
  /** Base branch for the PR target, e.g. "main" */
  base_branch: string;
  /** Absolute path to the git working directory (repo root) */
  repo_root: string;
  /** GitHub personal access token. Defaults to process.env.GITHUB_TOKEN */
  github_token?: string;
}

export interface PRSubmissionResult {
  skill_id: string;
  candidate_id: string;
  branch_name: string;
  pr_url: string | null;
  pr_number: number | null;
  /** 'created' = PR opened; 'skipped' = no token or no data; 'failed' = error */
  status: 'created' | 'skipped' | 'failed';
  error: string | null;
}

// ---------------------------------------------------------------------------
// Seam interface (injected into NightlyLoopContext)
// ---------------------------------------------------------------------------

/** Injected seam — lets the loop controller submit PRs without importing git/fetch directly. */
export interface PRSubmitter {
  submitPromotedSkills(
    c_result: PromotingGateResult,
    b_result: PhaseBBatchResult
  ): Promise<PRSubmissionResult[]>;
}

/** No-op implementation used when GITHUB_TOKEN is not configured. */
export const NULL_PR_SUBMITTER: PRSubmitter = {
  async submitPromotedSkills(_c_result, _b_result): Promise<PRSubmissionResult[]> {
    return [];
  },
};

// ---------------------------------------------------------------------------
// Git helper
// ---------------------------------------------------------------------------

interface GitResult { ok: boolean; stdout: string; stderr: string }

function git(args: string[], cwd: string): GitResult {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  return {
    ok: r.status === 0 && !r.error,
    stdout: (r.stdout ?? '').trim(),
    stderr: (r.stderr ?? '').trim(),
  };
}

// ---------------------------------------------------------------------------
// GitHub REST API helper
// ---------------------------------------------------------------------------

async function createGitHubPR(opts: {
  owner: string;
  repo: string;
  token: string;
  head: string;
  base: string;
  title: string;
  body: string;
}): Promise<{ url: string; number: number }> {
  const api_url = `https://api.github.com/repos/${opts.owner}/${opts.repo}/pulls`;
  const resp = await fetch(api_url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${opts.token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: opts.title,
      head: opts.head,
      base: opts.base,
      body: opts.body,
      draft: true,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '<no body>');
    throw new Error(`GitHub API ${resp.status}: ${text}`);
  }
  const data = await resp.json() as { html_url: string; number: number };
  return { url: data.html_url, number: data.number };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a live PRSubmitter that applies patches and opens GitHub PRs.
 *
 * If GITHUB_TOKEN is not available, returns NULL_PR_SUBMITTER.
 */
export function createPRSubmitter(config: PRSubmitterConfig): PRSubmitter {
  const token = config.github_token ?? process.env['GITHUB_TOKEN'] ?? '';

  if (!token) {
    return NULL_PR_SUBMITTER;
  }

  return {
    async submitPromotedSkills(
      c_result: PromotingGateResult,
      b_result: PhaseBBatchResult
    ): Promise<PRSubmissionResult[]> {
      // Build candidate_id → VerifiedPatch lookup
      const patch_map = new Map(b_result.verified.map((vp) => [vp.candidate_id, vp]));

      const results: PRSubmissionResult[] = [];

      // Read current branch so we can return to it after each attempt
      const head = git(['rev-parse', '--abbrev-ref', 'HEAD'], config.repo_root);
      const original_branch = head.ok ? head.stdout : config.base_branch;

      for (const gate_res of c_result.gate_results) {
        if (gate_res.disposition !== 'PROMOTED') continue;
        if (!gate_res.promoted_skill_id) continue;

        const skill = c_result.promoted_skills.find(
          (s) => s.skill_id === gate_res.promoted_skill_id
        );
        const vp = patch_map.get(gate_res.candidate_id);

        if (!skill || !vp) {
          results.push({
            skill_id: gate_res.promoted_skill_id,
            candidate_id: gate_res.candidate_id,
            branch_name: '',
            pr_url: null,
            pr_number: null,
            status: 'skipped',
            error: 'Matching PromotedSkill or VerifiedPatch not found',
          });
          continue;
        }

        const cycle_short = c_result.cycle_id.replace(/-/g, '').slice(0, 8);
        const skill_short = skill.skill_id.replace(/-/g, '').slice(0, 8);
        const branch_name = `auto/promote/${cycle_short}/${skill_short}`;

        try {
          // 1. Verify clean working tree
          const wt = git(['status', '--porcelain'], config.repo_root);
          if (wt.stdout) {
            throw new Error(`Unclean working tree before branch creation:\n${wt.stdout}`);
          }

          // 2. Create branch from remote base
          const cb = git(
            ['checkout', '-b', branch_name, `origin/${config.base_branch}`],
            config.repo_root
          );
          if (!cb.ok) {
            throw new Error(`git checkout -b: ${cb.stderr}`);
          }

          // 3. Write patch to temp file
          const tmp = path.join(os.tmpdir(), `antigravity_${skill_short}.diff`);
          fs.writeFileSync(tmp, vp.source_candidate.patch_diff, 'utf8');

          // 4. Apply patch (--3way for merge-conflict resilience)
          const apply = git(['apply', '--3way', tmp], config.repo_root);
          fs.rmSync(tmp, { force: true });
          if (!apply.ok) {
            throw new Error(`git apply: ${apply.stderr}`);
          }

          // 5. Stage and commit
          git(['add', '-A'], config.repo_root);
          const imp = skill.confirmed_improvements;
          const commit_lines = [
            `auto: [Antigravity] ${skill.title}`,
            '',
            `Cycle: ${c_result.cycle_id}`,
            `Skill: ${skill.skill_id}`,
            `Promoted at: ${skill.promoted_at}`,
            '',
            `stability_delta=${imp.stability_index_delta.toFixed(6)}`,
            `saved_min=${imp.saved_time_minutes ?? 0}`,
            `bugs_killed=${imp.bugs_killed ?? 0}`,
          ];
          const commit = git(
            ['commit', '-m', commit_lines.join('\n')],
            config.repo_root
          );
          if (!commit.ok) {
            throw new Error(`git commit: ${commit.stderr}`);
          }

          // 6. Push branch
          const push = git(['push', 'origin', branch_name], config.repo_root);
          if (!push.ok) {
            throw new Error(`git push: ${push.stderr}`);
          }

          // 7. Create GitHub Draft PR
          const imp_rows = [
            `| stability_index_delta | ${imp.stability_index_delta.toFixed(6)} |`,
            `| saved_time_minutes | ${imp.saved_time_minutes ?? 0} |`,
            `| bugs_killed | ${imp.bugs_killed ?? 0} |`,
            `| tokens_saved | ${imp.tokens_saved ?? 0} |`,
            `| refined_code_lines | ${imp.refined_code_lines ?? 0} |`,
          ].join('\n');

          const files_list = skill.affected_targets.map((t) => `- \`${t}\``).join('\n');

          const body = [
            `## \u{1F916} Antigravity OS — Autonomous Improvement`,
            '',
            `> **Draft PR — human review required before merge.**`,
            '',
            `| Field | Value |`,
            `|-------|-------|`,
            `| Cycle | \`${c_result.cycle_id}\` |`,
            `| Skill | \`${skill.skill_id}\` |`,
            `| Promoted | ${skill.promoted_at} |`,
            '',
            `### Improvement Evidence`,
            `| Metric | Value |`,
            `|--------|-------|`,
            imp_rows,
            '',
            `### Affected Files`,
            files_list,
            '',
            `### Patch`,
            '```diff',
            vp.source_candidate.patch_diff,
            '```',
          ].join('\n');

          const pr = await createGitHubPR({
            owner: config.repo_owner,
            repo: config.repo_name,
            token,
            head: branch_name,
            base: config.base_branch,
            title: `[Antigravity] ${skill.title}`,
            body,
          });

          results.push({
            skill_id: skill.skill_id,
            candidate_id: gate_res.candidate_id,
            branch_name,
            pr_url: pr.url,
            pr_number: pr.number,
            status: 'created',
            error: null,
          });

        } catch (err) {
          // Best-effort cleanup: delete branch if it was created
          git(['branch', '-D', branch_name], config.repo_root);

          results.push({
            skill_id: skill.skill_id,
            candidate_id: gate_res.candidate_id,
            branch_name,
            pr_url: null,
            pr_number: null,
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          });

        } finally {
          // Always restore to original branch — never leave the caller stranded
          git(['checkout', original_branch], config.repo_root);
        }
      }

      return results;
    },
  };
}
