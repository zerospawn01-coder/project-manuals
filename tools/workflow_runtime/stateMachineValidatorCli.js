"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_process_1 = __importDefault(require("node:process"));
const yaml_1 = __importDefault(require("yaml"));
function normalizeWindowsPath(value) {
    return value.replace(/^\\\\\?\\/, '');
}
function repoRoot() {
    return normalizeWindowsPath(node_path_1.default.resolve(__dirname, '..', '..'));
}
function defaultWorkflowPath() {
    return node_path_1.default.join(repoRoot(), 'workflows', 'operational_governance_stack.v0.1.yaml');
}
function defaultValidatorPath() {
    return node_path_1.default.join(repoRoot(), 'workflows', 'state_machine_validator.v0.1.yaml');
}
function parseArgs(argv) {
    let workflowPath = defaultWorkflowPath();
    let validatorPath = defaultValidatorPath();
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (token === '--workflow' && argv[i + 1]) {
            workflowPath = node_path_1.default.resolve(repoRoot(), argv[i + 1]);
            i += 1;
            continue;
        }
        if (token === '--validator' && argv[i + 1]) {
            validatorPath = node_path_1.default.resolve(repoRoot(), argv[i + 1]);
            i += 1;
        }
    }
    return { workflowPath, validatorPath };
}
function parseYamlFile(filePath) {
    const content = node_fs_1.default.readFileSync(filePath, 'utf8');
    return yaml_1.default.parse(content);
}
function pushIssue(list, severity, code, message, ctx) {
    list.push({ severity, code, message, ...ctx });
}
function validateWorkflowDefinition(workflowDoc, validatorDoc, workflowPath, validatorPath) {
    const errors = [];
    const warnings = [];
    const requiredTopLevelKeys = ['version', 'workflow_family', 'common', 'workflows'];
    for (const key of requiredTopLevelKeys) {
        if (!(key in (workflowDoc || {}))) {
            pushIssue(errors, 'error', 'MISSING_TOP_LEVEL_KEY', `Missing top-level key: ${key}`);
        }
    }
    const allowedStates = Array.isArray(workflowDoc?.common?.state_enum) ? workflowDoc.common.state_enum : [];
    if (allowedStates.length === 0) {
        pushIssue(errors, 'error', 'STATE_ENUM_MISSING', 'common.state_enum must be a non-empty array.');
    }
    if (!Array.isArray(workflowDoc?.workflows) || workflowDoc.workflows.length === 0) {
        pushIssue(errors, 'error', 'WORKFLOWS_MISSING', 'workflows must be a non-empty array.');
    }
    const validatorFailClosed = validatorDoc?.policy?.fail_closed;
    if (validatorFailClosed !== true) {
        pushIssue(warnings, 'warning', 'VALIDATOR_NOT_FAIL_CLOSED', 'Validator policy.fail_closed is not true.');
    }
    for (const workflow of workflowDoc?.workflows || []) {
        const workflowId = workflow?.id;
        if (!workflowId) {
            pushIssue(errors, 'error', 'WORKFLOW_ID_MISSING', 'Workflow entry is missing id.');
            continue;
        }
        const stages = Array.isArray(workflow?.stages) ? workflow.stages : [];
        if (stages.length === 0) {
            pushIssue(errors, 'error', 'WORKFLOW_STAGES_MISSING', `Workflow ${workflowId} has no stages.`, { workflowId });
            continue;
        }
        for (const stage of stages) {
            const stageId = stage?.id;
            const stateFlow = Array.isArray(stage?.state_flow) ? stage.state_flow : [];
            const decisionPoints = Array.isArray(stage?.decision_points) ? stage.decision_points : [];
            if (!stageId) {
                pushIssue(errors, 'error', 'STAGE_ID_MISSING', `Workflow ${workflowId} contains stage without id.`, {
                    workflowId,
                });
                continue;
            }
            if (stateFlow.length === 0) {
                pushIssue(errors, 'error', 'STATE_FLOW_MISSING', `Stage ${stageId} has no state_flow.`, {
                    workflowId,
                    stageId,
                });
            }
            if (stateFlow[0] !== 'PENDING') {
                pushIssue(errors, 'error', 'STATE_FLOW_START_INVALID', `Stage ${stageId} state_flow must start with PENDING.`, {
                    workflowId,
                    stageId,
                });
            }
            if (!stateFlow.includes('RUNNING')) {
                pushIssue(errors, 'error', 'STATE_FLOW_RUNNING_MISSING', `Stage ${stageId} state_flow must include RUNNING.`, {
                    workflowId,
                    stageId,
                });
            }
            for (const state of stateFlow) {
                if (!allowedStates.includes(state)) {
                    pushIssue(errors, 'error', 'STATE_ENUM_REFERENCE_INVALID', `Stage ${stageId} references unknown state ${state}.`, {
                        workflowId,
                        stageId,
                    });
                }
            }
            if (decisionPoints.length === 0) {
                pushIssue(errors, 'error', 'DECISION_POINTS_MISSING', `Stage ${stageId} must declare decision_points.`, {
                    workflowId,
                    stageId,
                });
                continue;
            }
            for (const decision of decisionPoints) {
                const decisionId = decision?.id;
                const allowedDecisionStates = Array.isArray(decision?.allowed_states) ? decision.allowed_states : [];
                if (!decisionId) {
                    pushIssue(errors, 'error', 'DECISION_ID_MISSING', `Stage ${stageId} contains decision point without id.`, {
                        workflowId,
                        stageId,
                    });
                    continue;
                }
                if (!Array.isArray(decision?.failure_codes) || decision.failure_codes.length === 0) {
                    pushIssue(errors, 'error', 'DECISION_FAILURE_CODES_MISSING', `Decision ${decisionId} must declare failure_codes.`, {
                        workflowId,
                        stageId,
                        decisionId,
                    });
                }
                if (!Array.isArray(decision?.evidence_fields) || decision.evidence_fields.length === 0) {
                    pushIssue(errors, 'error', 'DECISION_EVIDENCE_FIELDS_MISSING', `Decision ${decisionId} must declare evidence_fields.`, {
                        workflowId,
                        stageId,
                        decisionId,
                    });
                }
                for (const decisionState of allowedDecisionStates) {
                    if (!stateFlow.includes(decisionState)) {
                        pushIssue(errors, 'error', 'DECISION_ALLOWED_STATE_OUT_OF_STAGE_FLOW', `Decision ${decisionId} allowed state ${decisionState} is not in stage state_flow.`, {
                            workflowId,
                            stageId,
                            decisionId,
                        });
                    }
                }
            }
        }
    }
    return {
        ok: errors.length === 0,
        workflowPath,
        validatorPath,
        checkedAt: new Date().toISOString(),
        errors,
        warnings,
    };
}
function main() {
    const args = parseArgs(node_process_1.default.argv.slice(2));
    const workflowDoc = parseYamlFile(args.workflowPath);
    const validatorDoc = parseYamlFile(args.validatorPath);
    const report = validateWorkflowDefinition(workflowDoc, validatorDoc, args.workflowPath, args.validatorPath);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) {
        node_process_1.default.exit(1);
    }
}
main();
