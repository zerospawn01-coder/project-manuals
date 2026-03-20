"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PowerShellRepoSplitPreviewBackend = void 0;
const parsePreview_1 = require("../internal/parsePreview");
const runPowerShell_1 = require("../internal/runPowerShell");
const scriptRuntime_1 = require("../internal/scriptRuntime");
const planBackend_1 = require("./planBackend");
function createCopyOperation(entry) {
    return {
        phase: 'copy',
        action: `Would copy ${entry.sourcePath} to ${entry.targetRepo}/${entry.targetPath}`,
        sourcePath: entry.sourcePath,
        targetRepo: entry.targetRepo,
        targetPath: entry.targetPath,
        destructive: false,
        requiresConfirmation: true,
        warnings: entry.confidence === 'provisional' ? ['Provisional copy mapping requires operator review.'] : undefined,
    };
}
function createFilterRepoOperation(entry, remoteScheme) {
    return {
        phase: 'filter-repo',
        action: `Would create a temporary filtered clone for ${entry.sourcePath} and configure ${remoteScheme} remote`,
        sourcePath: entry.sourcePath,
        targetRepo: entry.targetRepo,
        targetPath: entry.targetPath,
        destructive: false,
        requiresConfirmation: true,
        warnings: ['Validate filtered clone before any push operation.'],
    };
}
function createArchiveOperation(entry, excludedAction) {
    return {
        phase: 'archive',
        action: `Would ${excludedAction} ${entry.sourcePath}`,
        sourcePath: entry.sourcePath,
        targetRepo: entry.targetRepo,
        targetPath: entry.targetPath,
        destructive: false,
        requiresConfirmation: true,
        warnings: [
            excludedAction === 'keep'
                ? 'Excluded placeholder remains untouched in preview mode.'
                : `Excluded placeholder would be handled with action: ${excludedAction}.`,
        ],
    };
}
function mapPreviewOperations(entries, input) {
    switch (input.phase) {
        case 'copy':
            return entries
                .filter((entry) => entry.migrationMode === 'copy' && entry.disposition === 'migrate')
                .map(createCopyOperation);
        case 'filter-repo':
            return entries
                .filter((entry) => entry.migrationMode === 'filter-repo' && entry.disposition === 'migrate')
                .map((entry) => createFilterRepoOperation(entry, input.remoteScheme || 'https'));
        case 'archive':
            return entries
                .filter((entry) => entry.disposition !== 'migrate')
                .map((entry) => createArchiveOperation(entry, input.excludedAction || 'keep'));
    }
}
class PowerShellRepoSplitPreviewBackend {
    planBackend;
    constructor(planBackend = new planBackend_1.PowerShellRepoSplitPlanBackend()) {
        this.planBackend = planBackend;
    }
    async loadPreview(input) {
        const entries = await this.planBackend.loadPlan({
            layout: input.layout,
            includeDeferred: true,
            format: 'json',
        });
        const result = await (0, runPowerShell_1.runPowerShell)((0, scriptRuntime_1.resolvePreviewScriptPath)(input.phase), (0, scriptRuntime_1.buildPhaseRuntimeArgs)(input.phase, input.runtime, {
            layout: input.layout,
            excludedAction: input.excludedAction,
            remoteScheme: input.remoteScheme,
            whatIf: true,
        }));
        if (result.exitCode !== 0) {
            throw new Error(result.stderr.trim() || `Preview script failed for phase ${input.phase}.`);
        }
        const parsed = (0, parsePreview_1.parsePreview)(result.stdout, result.stderr);
        const operations = mapPreviewOperations(entries, input);
        const warnings = [...parsed.warnings];
        if (parsed.detectedOperationCount > 0 && parsed.detectedOperationCount !== operations.length) {
            warnings.push(`Detected ${parsed.detectedOperationCount} WhatIf operations but normalized ${operations.length} preview operations.`);
        }
        return {
            operations,
            warnings,
            repos: parsed.repoHints,
            paths: parsed.pathHints,
            status: warnings.length > 0 ? 'degraded' : 'ok',
        };
    }
}
exports.PowerShellRepoSplitPreviewBackend = PowerShellRepoSplitPreviewBackend;
