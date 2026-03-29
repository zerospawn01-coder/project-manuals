import assert from 'node:assert/strict';
import {
  DynamicPromptOrchestrator,
  ValidatedDispatchRecord,
} from '../tools/dynamic_prompt_orchestrator';
import {
  ConstraintType,
  RejectionClass,
  RejectionPhase,
  Repairability,
  type ConstitutionRule,
  type RejectionTrace,
} from '../contract/ledger_icl';

function buildTrace(): RejectionTrace {
  return {
    trace_id: 'trace-001',
    timestamp: '2026-03-29T00:00:00.000Z',
    rejection_phase: RejectionPhase.GATE_EVALUATION,
    rejection_class: RejectionClass.MISSING_APPROVAL,
    repairability: Repairability.HUMAN_REPAIRABLE,
    primary_reason_code: 'missing_approval',
    intent_normalized: 'delete_user',
    operation_signature: 'DELETE /users/:id',
    blast_radius: 'SELF',
    risk_level: 'medium',
    related_constraints: [],
    generated_constraints: [
      {
        constraint_type: ConstraintType.REQUIRE_APPROVAL,
        rationale: 'Approval required for similar operations.',
        applied_rule: 'manual-fixture',
        confidence: 1,
        requires_hlg_review: false,
      },
    ],
    error_message: 'Approval token missing.',
    context: {
      request_id: 'req-001',
    },
    correction_applied: false,
  };
}

function buildRule(): ConstitutionRule {
  return {
    rule_id: 'rule-001',
    version: 1,
    name: 'Require approval for delete_user',
    constraint_type: ConstraintType.REQUIRE_APPROVAL,
    constraint_value: true,
    applies_when: {
      intent_pattern: 'delete_user',
      blast_radius: ['SELF'],
      risk_level: ['medium'],
    },
    enforcement_level: 'high',
    promotion_rationale: 'Fixture rule for regression coverage.',
    source_trace_ids: ['trace-001'],
    recurrence_count: 3,
    last_updated: '2026-03-29T00:00:00.000Z',
    hlg_approved: false,
    status: 'active',
  };
}

async function main() {
  const orchestrator = new DynamicPromptOrchestrator([buildTrace()], [buildRule()]);

  const acceptedRecords: ValidatedDispatchRecord[] = [];
  const result = await orchestrator.orchestrateAndDispatch(
    {
      intent: 'delete user',
      params: {
        method: 'DELETE',
        resource: '/users/42',
      },
      context: {
        week_id: '2026-W13',
        trace_id: 'trace-001',
        correlation_id: 'corr-001',
        run_id: 'run-001',
      },
    },
    (record) => {
      acceptedRecords.push(record);
    }
  );

  assert.equal(acceptedRecords.length, 1, 'Expected dispatch callback to receive a validated record.');
  assert.equal(result.dispatch_validation.schema_validated, true, 'Expected pre-dispatch schema validation to pass.');
  assert.equal(result.normalized.governance.blast_radius, 'SELF');
  assert(
    result.icl_prompt.includes('delete_user'),
    'Expected prompt to include normalized intent for the governed action.'
  );

  await assert.rejects(
    orchestrator.orchestrate({
      intent: 'delete user',
      params: {
        method: 'DELETE',
        resource: '/users/42',
      },
      context: {
        week_id: '2026-W13',
        trace_id: 'trace-001',
        run_id: 'run-002',
      },
    }),
    /DISPATCH_CONTEXT_REQUIRED: missing or invalid context\.correlation_id/
  );

  console.log('transaction_gate.test: ok');
}

void main();
