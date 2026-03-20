import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';

type Severity = 'error' | 'warning';

interface ValidationIssue {
  severity: Severity;
  code: string;
  message: string;
  workflowId?: string;
  stageId?: string;
  decisionId?: string;
}

interface ValidationReport {
  ok: boolean;
  workflowPath: string;
  validatorPath: string;
  checkedAt: string;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

interface ParsedArgs {
  workflowPath: string;
  validatorPath: string;
}

function normalizeWindowsPath(value: string): string {
  return value.replace(/^\\\\\?\\/, '');
}

function repoRoot(): string {
  return normalizeWindowsPath(path.resolve(__dirname, '..', '..'));
}

function defaultWorkflowPath(): string {
  return path.join(repoRoot(), 'workflows', 'operational_governance_stack.v0.1.yaml');
}

function defaultValidatorPath(): string {
  return path.join(repoRoot(), 'workflows', 'state_machine_validator.v0.1.yaml');
}

function parseArgs(argv: string[]): ParsedArgs {
  let workflowPath = defaultWorkflowPath();
  let validatorPath = defaultValidatorPath();

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--workflow' && argv[i + 1]) {
      workflowPath = path.resolve(repoRoot(), argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === '--validator' && argv[i + 1]) {
      validatorPath = path.resolve(repoRoot(), argv[i + 1]);
      i += 1;
    }
  }

  return { workflowPath, validatorPath };
}

function parseYamlFile(filePath: string): any {
  const content = fs.readFileSync(filePath, 'utf8');
  return YAML.parse(content);
}

function pushIssue(list: ValidationIssue[], severity: Severity, code: string, message: string, ctx?: Partial<ValidationIssue>) {
  list.push({ severity, code, message, ...ctx });
}

function validateWorkflowDefinition(workflowDoc: any, validatorDoc: any, workflowPath: string, validatorPath: string): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const requiredTopLevelKeys = ['version', 'workflow_family', 'common', 'workflows'];
  for (const key of requiredTopLevelKeys) {
    if (!(key in (workflowDoc || {}))) {
      pushIssue(errors, 'error', 'MISSING_TOP_LEVEL_KEY', `Missing top-level key: ${key}`);
    }
  }

  const allowedStates: string[] = Array.isArray(workflowDoc?.common?.state_enum) ? workflowDoc.common.state_enum : [];
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
      const stateFlow: string[] = Array.isArray(stage?.state_flow) ? stage.state_flow : [];
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
        const allowedDecisionStates: string[] = Array.isArray(decision?.allowed_states) ? decision.allowed_states : [];

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
  const args = parseArgs(process.argv.slice(2));

  const workflowDoc = parseYamlFile(args.workflowPath);
  const validatorDoc = parseYamlFile(args.validatorPath);
  const report = validateWorkflowDefinition(workflowDoc, validatorDoc, args.workflowPath, args.validatorPath);

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    process.exit(1);
  }
}

main();
