import assert from 'node:assert/strict';
import { validateWorkflowEvent } from '../tools/workflow_runtime/eventSchemaRuntimeValidator';

function main() {
  const validEvent = {
    event_id: 'evt-001',
    event_type: 'dispatch_recorded',
    timestamp: '2026-03-29T00:00:00.000Z',
    trace_id: 'trace-001',
    correlation_id: 'corr-001',
    run_id: 'run-001',
    workflow_id: 'dynamic_prompt_orchestrator',
    stage_id: 'dispatch',
    week_id: '2026-W13',
    state: 'PASS',
    severity: 'info',
    actor: {
      role: 'system',
      id: 'dynamic_prompt_orchestrator',
    },
    evidence: {
      normalized_intent: 'delete_user',
      operation_signature: 'DELETE /users/:id',
      blast_radius: 'SELF',
      risk_level: 'medium',
      filtered_trace_count: 1,
      injected_capsule_count: 0,
    },
    payload: {
      allowed_outputs: ['DENY'],
    },
    idempotency_key: '2026-W13:dispatch:run-001',
  };

  const tamperedEvent = {
    ...validEvent,
    correlation_id: undefined,
  };

  const validResult = validateWorkflowEvent(validEvent);
  const tamperedResult = validateWorkflowEvent(tamperedEvent);

  assert.equal(validResult.ok, true, `Expected canonical event to validate: ${validResult.errors.join('; ')}`);
  assert.equal(tamperedResult.ok, false, 'Expected tampered event to fail schema validation.');
  assert(
    tamperedResult.errors.some((error) => error.includes('correlation_id')),
    `Expected correlation_id failure, got: ${tamperedResult.errors.join('; ')}`
  );

  console.log('tamper_test: ok');
}

main();
