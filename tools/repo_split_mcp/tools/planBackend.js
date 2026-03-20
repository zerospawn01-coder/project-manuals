"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PowerShellRepoSplitPlanBackend = void 0;
exports.loadRepoSplitPlan = loadRepoSplitPlan;
const node_util_1 = require("node:util");
const node_child_process_1 = require("node:child_process");
const node_path_1 = __importDefault(require("node:path"));
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
const repoRoot = node_path_1.default.resolve(__dirname, '../../..');
const planScriptPath = node_path_1.default.join(repoRoot, 'tools', 'repo_split_plan.ps1');
function normalizeDisposition(entry) {
    if (entry.Disposition === 'include') {
        return 'migrate';
    }
    if (entry.Category === 'deferred') {
        return 'deferred';
    }
    return 'exclude';
}
function normalizeMigrationMode(entry) {
    if (entry.Disposition === 'include') {
        return entry.MigrationMode;
    }
    return 'exclude';
}
function normalizePlanEntry(entry) {
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
function filterEntries(entries, includeDeferred = false) {
    if (includeDeferred) {
        return entries;
    }
    return entries.filter((entry) => entry.disposition !== 'deferred');
}
async function loadRawPlan(layout) {
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', planScriptPath, '-Layout', layout, '-AsJson'];
    const { stdout } = await execFileAsync('pwsh', args, {
        cwd: repoRoot,
        windowsHide: true,
    });
    return JSON.parse(stdout);
}
class PowerShellRepoSplitPlanBackend {
    async loadPlan(input) {
        const rawPlan = await loadRawPlan(input.layout);
        const entries = rawPlan.PlanEntries.map(normalizePlanEntry);
        return filterEntries(entries, input.includeDeferred);
    }
}
exports.PowerShellRepoSplitPlanBackend = PowerShellRepoSplitPlanBackend;
async function loadRepoSplitPlan(input) {
    return new PowerShellRepoSplitPlanBackend().loadPlan(input);
}
