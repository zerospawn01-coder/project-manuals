"""
phase14/solvers/smoke_test_governance.py
─────────────────────────────────────────────────────────────────────────────
Governance smoke test: GovernedCompiler → Solve → ConstitutionalGate

Tests:
  T1  Happy path — GovernedCompiler produces snapshot_hash, Gate passes
  T2  Policy violation — soft weight overflow raises PolicyViolationError
  T3  Policy violation — penalty above max raises PolicyViolationError
  T4  Ungoverned path — plain QUBOCompiler without snapshot → R5b flag
  T5  Policy hash stability — reloading policy gives same hash
─────────────────────────────────────────────────────────────────────────────
"""

import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from constraint_ir import (
    ConstraintIR, VariableRegistry,
    ExactlyK, ForbiddenPair, MinimizeCost, AuditRequired, HumanReview,
)
from qubo_compiler import QUBOCompiler
from compiler_governance import (
    GovernedCompiler, load_policy, PolicyViolationError,
)
from solver_contract import SBMConfig
from sbm_solver import SBMSolver, brute_force_qubo
from constitutional_gate import ConstitutionalGate

_PASS = "PASS"
_FAIL = "FAIL"

def _make_ir(weights=(3.0, 1.0, 2.0), with_meta=True) -> tuple:
    reg = VariableRegistry().declare("job_A", "job_B", "job_C")
    ir  = ConstraintIR(registry=reg, policy_version="v1-gov-smoke")
    ir.add_hard(ExactlyK("h1", vars=["job_A","job_B","job_C"], k=2))
    ir.add_hard(ForbiddenPair("h2", var_a="job_A", var_b="job_B"))
    ir.add_soft(MinimizeCost("s1", vars=["job_A","job_B","job_C"], weights=list(weights)))
    if with_meta:
        ir.add_meta(AuditRequired("m1", reason="scheduling policy §2"))
        ir.add_meta(HumanReview("m2", threshold=0, reviewer="QA team"))
    return reg, ir

results = []

print("═══ Governance Smoke Tests ══════════════════════════════════════════")


# ── T1: Happy path ────────────────────────────────────────────────────────────
print("\n── T1: Happy path (GovernedCompiler → Solve → Gate) ─────────────────")
try:
    reg, ir = _make_ir()
    gov_result = GovernedCompiler(ir).compile()

    cfg    = SBMConfig(n_reads=50, n_steps=300)
    inp    = gov_result.to_solver_input(config=cfg, seed=42, problem_label="t1-gov")
    solver = SBMSolver(config=cfg, log_dir=None)
    output = solver.solve(inp)
    bf_x, bf_val = brute_force_qubo(gov_result.Q)
    gate   = ConstitutionalGate()
    verdict = gate.check(output, ir)

    status = _PASS if (
        gov_result.manifest.snapshot_hash is not None
        and gov_result.manifest.policy_hash is not None
        and output.provenance.policy_snapshot_hash == gov_result.manifest.snapshot_hash
        and verdict.passed
        and output.best_qubo_value <= bf_val + 1e-6
    ) else _FAIL

    print(f"  snapshot_hash   : {gov_result.manifest.snapshot_hash}")
    print(f"  policy_hash     : {gov_result.manifest.policy_hash}")
    print(f"  prov bound      : {output.provenance.policy_snapshot_hash}")
    print(f"  Gate passed     : {verdict.passed}")
    print(f"  Trust score     : {verdict.trust_score:.4f}")
    print(f"  Gap             : {output.best_qubo_value - bf_val:+.4f}")
    print(f"  → T1: {status}")
    results.append(("T1 Happy path", status))
except Exception as e:
    print(f"  ERROR: {e}")
    results.append(("T1 Happy path", _FAIL))


# ── T2: Soft weight overflow ──────────────────────────────────────────────────
print("\n── T2: Soft weight overflow → PolicyViolationError ──────────────────")
try:
    reg, ir2 = _make_ir(weights=[150.0, 1.0, 2.0])
    try:
        GovernedCompiler(ir2).compile()
        print("  ERROR: no exception raised")
        results.append(("T2 Weight overflow", _FAIL))
    except PolicyViolationError as e:
        codes = [v.code for v in e.violations]
        ok = "SOFT_WEIGHT_OVERFLOW" in codes
        print(f"  Caught: {e}")
        print(f"  → T2: {_PASS if ok else _FAIL}")
        results.append(("T2 Weight overflow", _PASS if ok else _FAIL))
except Exception as e:
    print(f"  Unexpected error: {e}")
    results.append(("T2 Weight overflow", _FAIL))


# ── T3: Penalty above max (override) ─────────────────────────────────────────
print("\n── T3: penalty_override > policy.max → PolicyViolationError ─────────")
try:
    reg, ir3 = _make_ir(weights=[3.0, 1.0, 2.0])
    try:
        GovernedCompiler(ir3, penalty_override=9999.0).compile()
        print("  ERROR: no exception raised")
        results.append(("T3 Penalty above max", _FAIL))
    except PolicyViolationError as e:
        codes = [v.code for v in e.violations]
        ok = "PENALTY_ABOVE_MAX" in codes
        print(f"  Caught: {e}")
        print(f"  → T3: {_PASS if ok else _FAIL}")
        results.append(("T3 Penalty above max", _PASS if ok else _FAIL))
except Exception as e:
    print(f"  Unexpected error: {e}")
    results.append(("T3 Penalty above max", _FAIL))


# ── T4: Ungoverned compiler → R5b flag ───────────────────────────────────────
print("\n── T4: Ungoverned QUBOCompiler → R5b liability flag ─────────────────")
try:
    reg, ir4 = _make_ir()
    # Plain QUBOCompiler — no policy_snapshot set
    plain_result = QUBOCompiler(ir4).compile()
    # provenance.policy_snapshot_hash will be None
    cfg    = SBMConfig(n_reads=30, n_steps=200)
    inp4   = plain_result.to_solver_input(config=cfg, seed=0, problem_label="t4-ungov")
    solver4 = SBMSolver(config=cfg, log_dir=None)
    out4 = solver4.solve(inp4)

    gate4   = ConstitutionalGate()
    verdict4 = gate4.check(out4, ir4)

    has_r5b = any("ungoverned" in f for f in verdict4.liability_flags)
    print(f"  policy_snapshot : {out4.provenance.policy_snapshot_hash!r}")
    print(f"  liability_flags : {verdict4.liability_flags}")
    print(f"  R5b triggered   : {has_r5b}")
    status = _PASS if has_r5b else _FAIL
    print(f"  → T4: {status}")
    results.append(("T4 R5b flag", status))
except Exception as e:
    print(f"  ERROR: {e}")
    results.append(("T4 R5b flag", _FAIL))


# ── T5: Policy hash stability ─────────────────────────────────────────────────
print("\n── T5: Policy hash stability (two loads, same hash) ─────────────────")
try:
    p1 = load_policy()
    p2 = load_policy()
    h1 = p1.policy_hash()
    h2 = p2.policy_hash()
    ok = h1 == h2 and len(h1) == 16
    print(f"  hash1           : {h1}")
    print(f"  hash2           : {h2}")
    print(f"  stable          : {ok}")
    print(f"  → T5: {_PASS if ok else _FAIL}")
    results.append(("T5 Hash stability", _PASS if ok else _FAIL))
except Exception as e:
    print(f"  ERROR: {e}")
    results.append(("T5 Hash stability", _FAIL))


# ── Summary ───────────────────────────────────────────────────────────────────
print("\n═══ Results ═════════════════════════════════════════════════════════")
all_pass = True
for name, status in results:
    icon = "✓" if status == _PASS else "✗"
    print(f"  {icon}  {name:<30} {status}")
    if status != _PASS:
        all_pass = False

print(f"\n  Governance smoke test: {'ALL PASS' if all_pass else 'FAILURES PRESENT'}")
