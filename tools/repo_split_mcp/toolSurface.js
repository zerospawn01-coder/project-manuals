"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REPO_SPLIT_TOOL_NAMES = void 0;
exports.createRepoSplitToolSurface = createRepoSplitToolSurface;
const plan_1 = require("./tools/plan");
const preview_1 = require("./tools/preview");
const createConfirmation_1 = require("./tools/createConfirmation");
const executeConfirmed_1 = require("./tools/executeConfirmed");
exports.REPO_SPLIT_TOOL_NAMES = [
    'repo_split.plan',
    'repo_split.preview',
    'repo_split.create_confirmation',
    'repo_split.execute_confirmed',
];
function createRepoSplitToolSurface(dependencies) {
    return {
        'repo_split.plan': (input) => (0, plan_1.buildRepoSplitPlan)(input, dependencies.planBackend),
        'repo_split.preview': (input) => (0, preview_1.buildRepoSplitPreview)(input, dependencies.previewBackend),
        'repo_split.create_confirmation': createConfirmation_1.createConfirmation,
        'repo_split.execute_confirmed': executeConfirmed_1.executeConfirmed,
    };
}
