import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import assert from 'node:assert';

function run(): void {
  const root = process.cwd().replace(/^\\\\\?\\/, '');
  const outPath = path.join(root, 'phase14', 'data', 'comparison_gate_result.test.json');
  const ledgerPath = path.join(root, 'phase14', 'data', 'ledger', 'decision_log.test.jsonl');

  if (fs.existsSync(ledgerPath)) {
    fs.unlinkSync(ledgerPath);
  }

  execSync(`node dist/tools/comparison_gate_cli.js --out "${outPath}" --ledger-out "${ledgerPath}" --dry-freeze`, {
    cwd: root,
    stdio: 'pipe',
  });

  assert.equal(fs.existsSync(outPath), true, 'gate output file must be created');

  const payload = JSON.parse(fs.readFileSync(outPath, 'utf8')) as Record<string, unknown>;
  const decision = payload.decision as string;

  assert.equal(['ACCEPT', 'REJECT', 'REVIEW_REQUIRED'].includes(decision), true, 'decision must be externally consumable enum');
  assert.equal(typeof payload.freeze_required, 'boolean', 'freeze_required must be exported for downstream systems');
  assert.equal(typeof payload.requires_human, 'boolean', 'human override requirement must be exported');
  assert.equal(typeof payload.policy, 'object', 'policy must be included in external result');
  assert.equal(fs.existsSync(ledgerPath), true, 'decision ledger must be appended');

  const lines = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n').filter((line) => line.length > 0);
  assert.equal(lines.length >= 1, true, 'decision ledger must include at least one entry');

  console.log('comparison_gate_output.test: all cases passed');
}

run();
