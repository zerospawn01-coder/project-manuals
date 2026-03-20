"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.repoSplitScriptPaths = void 0;
exports.resolvePreviewScriptPath = resolvePreviewScriptPath;
exports.buildSharedScratchArgs = buildSharedScratchArgs;
exports.buildPhaseRuntimeArgs = buildPhaseRuntimeArgs;
const node_path_1 = __importDefault(require("node:path"));
const repoRoot = node_path_1.default.resolve(__dirname, '../../..');
exports.repoSplitScriptPaths = {
    copy: node_path_1.default.join(repoRoot, 'tools', 'repo_split_copy.ps1'),
    'filter-repo': node_path_1.default.join(repoRoot, 'tools', 'repo_split_filter_repo.ps1'),
    archive: node_path_1.default.join(repoRoot, 'tools', 'repo_split_archive.ps1'),
};
function resolvePreviewScriptPath(phase) {
    return exports.repoSplitScriptPaths[phase];
}
function buildSharedScratchArgs(runtime) {
    if (!runtime?.sourceRoot) {
        return [];
    }
    const normalizedSourceRoot = node_path_1.default.resolve(runtime.sourceRoot);
    return ['-Root', node_path_1.default.dirname(normalizedSourceRoot), '-ScratchName', node_path_1.default.basename(normalizedSourceRoot)];
}
function buildPhaseRuntimeArgs(phase, runtime, options) {
    const args = [...buildSharedScratchArgs(runtime), '-Layout', options.layout];
    if (options.whatIf) {
        args.push('-WhatIf');
    }
    switch (phase) {
        case 'copy':
            if (runtime?.destinationRoot) {
                args.push('-DestinationRoot', runtime.destinationRoot);
            }
            return args;
        case 'filter-repo':
            if (runtime?.tempRoot) {
                args.push('-TempRoot', runtime.tempRoot);
            }
            if (options.remoteScheme) {
                args.push('-RemoteScheme', options.remoteScheme);
            }
            return args;
        case 'archive':
            if (options.excludedAction) {
                args.push('-ExcludedAction', options.excludedAction);
            }
            return args;
    }
}
