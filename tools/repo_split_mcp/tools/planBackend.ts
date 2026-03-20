import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import path from 'node:path';
import type { PlanEntry } from '../schemas/planEntry';
import type { RepoSplitLayout, RepoSplitPlanBackend, RepoSplitPlanInput } from './plan';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(__dirname, '../../..');
const planScriptPath = path.join(repoRoot, 'tools', 'repo_split_plan.ps1');

interface RawPlanEntry {
  SourcePath: string;
  Category: string;
  TargetRepo: string;
  TargetPath: string;
  MigrationMode: 'copy' | 'filter-repo' | 'exclude';
  Confidence: 'confirmed' | 'provisional';
  Disposition: 'include' | 'exclude';
  Notes?: string;
}

interface RawPlanPayload {
  Layout: RepoSplitLayout;
  PlanEntries: RawPlanEntry[];
}

function normalizeDisposition(entry: RawPlanEntry): PlanEntry['disposition'] {
  if (entry.Disposition === 'include') {
    return 'migrate';
  }
  if (entry.Category === 'deferred') {
    return 'deferred';
  }
  return 'exclude';
}

function normalizeMigrationMode(entry: RawPlanEntry): PlanEntry['migrationMode'] {
  if (entry.Disposition === 'include') {
    return entry.MigrationMode;
  }
  return 'exclude';
}

function normalizePlanEntry(entry: RawPlanEntry): PlanEntry {
  return {
    sourcePath: entry.SourcePath,
    category: entry.Category,
    targetRepo: entry.TargetRepo,
    targetPath: entry.TargetPath,
    migrationMode: normalizeMigrationMode(entry),
    confidence: entry.Confidence,
    disposition: normalizeDisposition(entry),
    notes: entry.Notes || '',
  };
}

function filterEntries(entries: PlanEntry[], includeDeferred = false): PlanEntry[] {
  if (includeDeferred) {
    return entries;
  }
  return entries.filter((entry) => entry.disposition !== 'deferred');
}

async function loadRawPlan(layout: RepoSplitLayout): Promise<RawPlanPayload> {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', planScriptPath, '-Layout', layout, '-AsJson'];
  const { stdout } = await execFileAsync('pwsh', args, {
    cwd: repoRoot,
    windowsHide: true,
  });

  return JSON.parse(stdout) as RawPlanPayload;
}

export class PowerShellRepoSplitPlanBackend implements RepoSplitPlanBackend {
  async loadPlan(input: RepoSplitPlanInput): Promise<PlanEntry[]> {
    const rawPlan = await loadRawPlan(input.layout);
    const entries = rawPlan.PlanEntries.map(normalizePlanEntry);
    return filterEntries(entries, input.includeDeferred);
  }
}

export async function loadRepoSplitPlan(input: RepoSplitPlanInput): Promise<PlanEntry[]> {
  return new PowerShellRepoSplitPlanBackend().loadPlan(input);
}
