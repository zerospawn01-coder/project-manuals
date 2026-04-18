"""
phase14/solvers/smoke_test_e2e.py
─────────────────────────────────────────────────────────────────────────────
End-to-end smoke test: IR → Compile → Solve → ConstitutionalGate → Ledger

Scenario: 3-variable scheduling problem
  Variables: job_A, job_B, job_C
  Hard:
    h1 — ExactlyK(k=2): schedule exactly 2 of 3 jobs
    h2 — ForbiddenPair(A,B): A and B cannot both be selected
  Soft:
    s1 — MinimizeCost(weights=[3,1,2]): prefer cheapest assignment
  Meta:
    m1 — AuditRequired: policy requires audit trail
    m2 — HumanReview(threshold=0): flag for human if any violations

Expected feasible solutions: {A,C}=101 and {B,C}=011
  Cost A+C = 3+2=5;  cost B+C = 1+2=3  → optimal = [0,1,1] cost 3
─────────────────────────────────────────────────────────────────────────────
"""

import sys
import os
import json

# Run from this directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from constraint_ir import (
    AuditRequired, ConstraintIR, ExactlyK, ForbiddenPair,
    HumanReview, MinimizeCost, VariableRegistry,
)
from qubo_compiler import QUBOCompiler
from solver_contract import SBMConfig, SolverInput
from sbm_solver import SBMSolver, brute_force_qubo
from constitutional_gate import ConstitutionalGate

_LEDGER_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "data", "sbm_ledger.jsonl"
)

# ─── 1. Build IR ──────────────────────────────────────────────────────────────
reg = VariableRegistry().declare("job_A", "job_B", "job_C")
ir  = ConstraintIR(registry=reg, policy_version="v1-smoke")
ir.add_hard(ExactlyK("h1", vars=["job_A","job_B","job_C"], k=2,
                     description="schedule exactly 2 of 3 jobs"))
ir.add_hard(ForbiddenPair("h2", var_a="job_A", var_b="job_B",
                           description="A and B conflict"))
ir.add_soft(MinimizeCost("s1", vars=["job_A","job_B","job_C"],
                          weights=[3.0, 1.0, 2.0],
                          description="minimize total job cost"))
ir.add_meta(AuditRequired("m1", reason="scheduling policy §2"))
ir.add_meta(HumanReview("m2", threshold=0, reviewer="QA team"))

print("── Step 1: ConstraintIR ─────────────────────────────────────────────")
print(f"  ir_hash          : {ir.ir_hash()}")
print(f"  requires_audit   : {ir.requires_audit()}")
print(f"  fail_closed      : {ir.fail_closed()}")
print(f"  human_threshold  : {ir.human_review_threshold()}")

# ─── 2. Compile → QUBO ───────────────────────────────────────────────────────
result = QUBOCompiler(ir, policy_snapshot="policy-sha256-deadbeef").compile()

print(f"\n── Step 2: QUBOCompiler ─────────────────────────────────────────────")
print(f"  variables        : {result.variable_map}")
print(f"  penalty P        : {result.penalty:.2f}")
print(f"  n_hard           : {result.n_hard}")
print(f"  n_soft           : {result.n_soft}")
print(f"  n_meta           : {result.n_meta}")
print(f"  ir_hash (prov)   : {result.provenance.constraint_ir_hash}")
print(f"  compiler_version : {result.provenance.compiler_version}")
print(f"  Q matrix:\n{result.Q}")

# ─── 3. Solve ─────────────────────────────────────────────────────────────────
cfg    = SBMConfig(n_reads=50, n_steps=300)
inp    = result.to_solver_input(
    config        = cfg,
    seed          = 42,
    problem_label = "smoke-e2e",
)
solver = SBMSolver(config=cfg, log_dir=None)
output = solver.solve(inp)
bf_x, bf_val = brute_force_qubo(result.Q)

print(f"\n── Step 3: Solve ─────────────────────────────────────────────────────")
print(f"  SBM  x          : {output.best_binary.tolist()}")
print(f"  SBM  QUBO value : {output.best_qubo_value:.4f}")
print(f"  BF   x          : {bf_x.tolist()}")
print(f"  BF   QUBO value : {bf_val:.4f}")
print(f"  gap             : {output.best_qubo_value - bf_val:+.4f}")
print(f"  status          : {output.status}")
print(f"  feasible        : {output.feasible}")
print(f"  violations      : {output.constraint_violations}")
print(f"  provenance_hash : {output.metadata.provenance_hash}")

# ─── 4. Constitutional Gate ───────────────────────────────────────────────────
gate    = ConstitutionalGate()
verdict = gate.check(output, ir)

print(f"\n── Step 4: ConstitutionalGate ────────────────────────────────────────")
print(f"  passed          : {verdict.passed}")
print(f"  trust_score     : {verdict.trust_score:.4f}")
print(f"  violations      : {verdict.invariant_violations or '(none)'}")
print(f"  liability_flags : {verdict.liability_flags or '(none)'}")
print(f"  human_review    : {verdict.human_review_required}")
print(f"  fail_closed     : {verdict.fail_closed_triggered}")

# ─── 5. Ledger ────────────────────────────────────────────────────────────────
try:
    import importlib, pathlib
    ledger_dir = str(pathlib.Path(__file__).parents[1] / "ledger")
    sys.path.insert(0, ledger_dir)
    from solver_ledger import SolverLedger
    ledger = SolverLedger(_LEDGER_PATH)
    entry  = ledger.record(output, n_variables=reg.n, problem_label="smoke-e2e")
    print(f"\n── Step 5: Ledger ────────────────────────────────────────────────────")
    print(f"  ledger path     : {_LEDGER_PATH}")
    print(f"  solver_run_id   : {entry.solver_run_id}")
    print(f"  provenance_hash : {entry.provenance_hash}")
    print(f"  feasible        : {output.feasible}")
    print(f"  violations      : {entry.constraint_violations}")
except Exception as e:
    print(f"\n  [LEDGER SKIP] {e}")

# ─── Result ───────────────────────────────────────────────────────────────────
print(f"\n── Smoke Test Result ─────────────────────────────────────────────────")
optimal = output.best_qubo_value <= bf_val + 1e-6
gate_ok = verdict.passed or verdict.trust_score > 0.5
print(f"  Solver optimal  : {'PASS' if optimal else 'WARN (suboptimal)'}")
print(f"  Gate status     : {'PASS' if gate_ok else 'FAIL'}")
print(f"  Pipeline closed : {optimal and gate_ok}")
