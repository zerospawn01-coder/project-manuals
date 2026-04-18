"""
phase14/solvers/constitutional_gate.py
─────────────────────────────────────────────────────────────────────────────
Post-Solve Constitutional Gate v1.

Checks a SolverOutput against the ConstraintIR that produced the run and
returns a GateVerdict with:
  · passed                 — bool composite gate result
  · trust_score            — floating-point 0–1 confidence
  · invariant_violations   — list of human-readable rule failures
  · liability_flags        — accountability warnings for the audit trail
  · human_review_required  — triggered by MetaConstraint HumanReview threshold
  · fail_closed_triggered  — IR contained FailClosed AND solver did not converge

─── Trust scoring formula ────────────────────────────────────────────────────
  base = 1.0
  For each invariant violation: base -= 1 / max(n_hard, 1)
  For each liability flag:      base -= 0.05
  trust_score = max(0.0, base)

─── Constitutional rules ─────────────────────────────────────────────────────
  R1  If output.status == INFEASIBLE → invariant_violation: "solver returned INFEASIBLE"
  R2  If ir.fail_closed() and output.status in {INFEASIBLE, ERROR}:
          fail_closed_triggered = True
          Override passed → False  (regardless of other checks)
  R3  If provenance_hash == "(manual)" and ir.requires_audit():
          liability_flag: "manual QUBO bypassed audit-required IR"
  R4  Constraint violations > HumanReview threshold → human_review_required
  R5  Provenance compiler_version mismatch with expected → liability flag

─────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from solver_contract import SolverOutput, SolverStatus
from constraint_ir import ConstraintIR, HumanReview

_EXPECTED_COMPILER_VERSION = "qubo_compiler-1.0"


# ─── Verdict ─────────────────────────────────────────────────────────────────

@dataclass
class GateVerdict:
    """
    Result of one ConstitutionalGate.check() call.
    """
    passed:                bool
    trust_score:           float       # 0.0 – 1.0
    invariant_violations:  list[str]   = field(default_factory=list)
    liability_flags:       list[str]   = field(default_factory=list)
    human_review_required: bool        = False
    fail_closed_triggered: bool        = False

    def to_dict(self) -> dict:
        return {
            "passed"                : self.passed,
            "trust_score"          : round(self.trust_score, 6),
            "invariant_violations" : self.invariant_violations,
            "liability_flags"      : self.liability_flags,
            "human_review_required": self.human_review_required,
            "fail_closed_triggered": self.fail_closed_triggered,
        }


# ─── Gate ────────────────────────────────────────────────────────────────────

class ConstitutionalGate:
    """
    Post-solve constitutional check.

    Parameters
    ----------
    expected_compiler : str | None
        If provided, verifies that the provenance compiler_version matches.
        Defaults to ``_EXPECTED_COMPILER_VERSION``.
    """

    def __init__(
        self,
        expected_compiler: Optional[str] = None,
    ):
        self._expected_compiler: Optional[str] = (
            expected_compiler
            if expected_compiler is not None
            else _EXPECTED_COMPILER_VERSION
        )

    def check(self, output: SolverOutput, ir: ConstraintIR) -> GateVerdict:
        """
        Run all constitutional rules and return a GateVerdict.

        Parameters
        ----------
        output : SolverOutput   — result of SBMSolver.solve()
        ir     : ConstraintIR   — the IR used to compile the QUBO
        """
        violations:    list[str] = []
        liabilities:   list[str] = []
        human_review:  bool      = False
        fail_closed:   bool      = False

        prov = output.provenance  # may be None for manual runs

        # R1 — solver returned INFEASIBLE or ERROR
        if output.status == SolverStatus.INFEASIBLE:
            violations.append("solver returned INFEASIBLE")
        if output.status == SolverStatus.ERROR:
            violations.append("solver returned ERROR")

        # R2 — fail-closed guard
        if ir.fail_closed() and output.status in (
            SolverStatus.INFEASIBLE,
            SolverStatus.ERROR,
        ):
            fail_closed = True

        # R3 — manual QUBO bypassed audit-required IR
        prov_hash = (
            output.metadata.provenance_hash
            if output.metadata is not None
            else "(manual)"
        )
        if prov_hash == "(manual)" and ir.requires_audit():
            liabilities.append(
                "manual QUBO bypassed audit-required IR "
                f"(ir_hash={ir.ir_hash()})"
            )

        # R4 — human review threshold from MetaConstraint
        threshold = ir.human_review_threshold()
        if threshold is not None:
            n_violations = (
                output.constraint_violations
                if hasattr(output, "constraint_violations")
                and output.constraint_violations is not None
                else 0
            )
            if n_violations > threshold:
                human_review = True
                liabilities.append(
                    f"constraint violations ({n_violations}) exceed "
                    f"HumanReview threshold ({threshold})"
                )

        # R5 — compiler version mismatch or missing snapshot_hash
        if self._expected_compiler is not None and prov is not None:
            if prov.compiler_version != self._expected_compiler:
                liabilities.append(
                    f"compiler version mismatch: "
                    f"expected '{self._expected_compiler}', "
                    f"got '{prov.compiler_version}'"
                )
        # R5b — ungoverned compilation: no snapshot_hash despite policy IR
        if prov is not None and ir.requires_audit():
            snap = prov.policy_snapshot_hash
            if snap is None:
                liabilities.append(
                    "ungoverned compilation: policy_snapshot_hash absent "
                    "for audit-required IR — use GovernedCompiler"
                )

        # ── Compute trust score ───────────────────────────────────────────────
        n_hard = max(len(ir.hard), 1)
        trust  = 1.0
        for _ in violations:
            trust -= 1.0 / n_hard
        for _ in liabilities:
            trust -= 0.05
        trust = max(0.0, trust)

        # ── Composite pass/fail ───────────────────────────────────────────────
        passed = (
            len(violations) == 0
            and not fail_closed
        )

        return GateVerdict(
            passed                = passed,
            trust_score           = trust,
            invariant_violations  = violations,
            liability_flags       = liabilities,
            human_review_required = human_review,
            fail_closed_triggered = fail_closed,
        )


# ─── Self-contained demo ──────────────────────────────────────────────────────

def _demo() -> None:
    """
    Run the constitutional gate against the scheduling demo from qubo_compiler.
    """
    import sys, os
    sys.path.insert(0, os.path.dirname(__file__))

    from constraint_ir import (
        ConstraintIR, VariableRegistry,
        ExactlyK, ForbiddenPair, MinimizeCost, AuditRequired, HumanReview,
    )
    from solver_contract import SolverInput, SBMConfig
    from sbm_solver import SBMSolver, brute_force_qubo
    from qubo_compiler import QUBOCompiler

    # ── Build IR ──────────────────────────────────────────────────────────────
    reg = VariableRegistry().declare("job_A", "job_B", "job_C")
    ir  = ConstraintIR(registry=reg, policy_version="v1-gate-demo")
    ir.add_hard(ExactlyK("h1", vars=["job_A","job_B","job_C"], k=2))
    ir.add_hard(ForbiddenPair("h2", var_a="job_A", var_b="job_B"))
    ir.add_soft(MinimizeCost("s1", vars=["job_A","job_B","job_C"],
                              weights=[3.0, 1.0, 2.0]))
    ir.add_meta(AuditRequired("m1", reason="scheduling policy §2"))
    ir.add_meta(HumanReview("m2", threshold=0, reviewer="QA team"))

    # ── Compile ───────────────────────────────────────────────────────────────
    result   = QUBOCompiler(ir, policy_snapshot="demo-policy-deadbeef").compile()
    inp      = result.to_solver_input(seed=7, problem_label="gate-demo")
    solver   = SBMSolver(SBMConfig(n_reads=30), log_dir=None)
    output   = solver.solve(inp)

    # ── Gate ──────────────────────────────────────────────────────────────────
    gate    = ConstitutionalGate()
    verdict = gate.check(output, ir)

    bf_x, bf_val = brute_force_qubo(result.Q)

    print("=== Constitutional Gate Demo ===")
    print(f"  SBM  x          : {output.best_binary.tolist()}")
    print(f"  SBM  QUBO value : {output.best_qubo_value:.4f}")
    print(f"  BF   x          : {bf_x.tolist()}")
    print(f"  BF   QUBO value : {bf_val:.4f}")
    print(f"  gap             : {output.best_qubo_value - bf_val:+.4f}")
    print()
    print(f"  Gate passed     : {verdict.passed}")
    print(f"  Trust score     : {verdict.trust_score:.4f}")
    print(f"  Violations      : {verdict.invariant_violations or '(none)'}")
    print(f"  Liability flags : {verdict.liability_flags or '(none)'}")
    print(f"  Human review    : {verdict.human_review_required}")
    print(f"  Fail-closed     : {verdict.fail_closed_triggered}")


if __name__ == "__main__":
    _demo()
