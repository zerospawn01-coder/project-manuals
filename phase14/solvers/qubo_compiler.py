"""
phase14/solvers/qubo_compiler.py
─────────────────────────────────────────────────────────────────────────────
QUBO Compiler v1 — IR → QUBO matrix.

Translates a ConstraintIR into a QUBO matrix Q (n×n numpy array) and fills
in the QUBOProvenance record so every solver invocation knows exactly which
IR version and policy snapshot produced Q.

Penalty method  : standard QUBO penalty encoding.
  · Hard constraint penalty  P  multiplies the constraint violation term.
    Default P = 10 * max(|soft_coefficients|) + 1  (guarantees hard > soft).
  · Soft constraints contribute their objective coefficients directly.

Encoding summary for hard constraints:

  ExactlyOne / AtMostOne / AtLeastOne / ExactlyK:
      Use (Σ x_i - k)^2  (or one-sided variants) × P
      Expanded: P * [k^2 - 2k Σ x_i + Σ_i x_i^2 + 2 Σ_{i<j} x_i x_j]
      QDiag contribution: x_i^2 = x_i  (binary), so diagonal gets (1 - 2k) coefficient
      Off-diag gets 2 per pair.

  Implication (x_a → x_b):
      (1 - x_b) * x_a = x_a - x_a x_b  →  add P*x_a, subtract P*x_a*x_b
      Diagonal: Q[a,a] += P
      Off-diag: Q[a,b] -= P  (x_a*x_b term removes the penalty when b=1)

  ForbiddenPair (x_a + x_b ≤ 1):
      (x_a * x_b) ≥ 1 violates; penalty P * x_a * x_b
      Off-diag only: Q[a,b] += P

  Equality (x_a = x_b):
      (x_a - x_b)^2 = x_a + x_b - 2 x_a x_b
      Q[a,a] += P, Q[b,b] += P, Q[a,b] -= 2P

  Soft MinimizeCost / MinimizeSum:
      Q[i,i] += w_i

  Soft MaximizeUtility:
      Q[i,i] -= w_i   (flip sign to minimise)

  Soft PenalizePair:
      Q[a,b] += w     (upper triangular; compiler symmetrises if needed)

─────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Optional

import numpy as np

from constraint_ir import (
    AnyHardConstraint,
    AnyMetaConstraint,
    AnySoftConstraint,
    AtLeastOne,
    AtMostOne,
    ConstraintIR,
    Equality,
    ExactlyK,
    ExactlyOne,
    FailClosed,
    ForbiddenPair,
    Implication,
    MaximizeUtility,
    MetaConstraint,
    MinimizeCost,
    MinimizeSum,
    MutualExclusion,
    PenalizePair,
    VariableRegistry,
)
from solver_contract import QUBOProvenance, SolverInput, SBMConfig

_COMPILER_VERSION = "qubo_compiler-1.0"


# ─── Compiler result ─────────────────────────────────────────────────────────

@dataclass
class CompilerResult:
    """
    Output of QUBOCompiler.compile().
    Contains everything needed to construct a SolverInput directly.
    """
    Q:                np.ndarray      # compiled n×n QUBO matrix
    provenance:       QUBOProvenance  # filled-in provenance record
    ir_dict:          dict            # snapshot of the ConstraintIR
    penalty:          float           # auto-computed or user-supplied penalty P
    variable_map:     list[str]       # column index → variable label
    n_hard:           int
    n_soft:           int
    n_meta:           int

    def to_solver_input(
        self,
        config:        Optional[SBMConfig] = None,
        seed:          Optional[int]       = None,
        problem_label: str                 = "",
    ) -> SolverInput:
        """Convenience: wrap compiled Q + provenance into a SolverInput."""
        return SolverInput(
            Q             = self.Q,
            config        = config or SBMConfig(),
            seed          = seed,
            problem_label = problem_label,
            provenance    = self.provenance,
        )


# ─── Compiler ────────────────────────────────────────────────────────────────

class QUBOCompiler:
    """
    Translate ConstraintIR → QUBO matrix.

    Parameters
    ----------
    ir              : ConstraintIR  — typed constraint graph
    penalty         : float | None  — override auto-computed penalty P
    policy_snapshot : str | None    — hash of the policy/constitution that
                                      authorised this IR
    """

    def __init__(
        self,
        ir:               ConstraintIR,
        penalty:          Optional[float] = None,
        policy_snapshot:  Optional[str]   = None,
    ):
        self.ir               = ir
        self._penalty_override = penalty
        self._policy_snapshot  = policy_snapshot

    # ── Public API ────────────────────────────────────────────────────────────

    def compile(self) -> CompilerResult:
        """Compile the IR into a QUBO matrix and return a CompilerResult."""
        reg = self.ir.registry
        n   = reg.n
        if n == 0:
            raise ValueError("ConstraintIR has no variables declared")

        Q = np.zeros((n, n))

        # 1. Accumulate soft objective (sets scale for auto-penalty)
        self._encode_soft(Q)

        # 2. Compute auto penalty = max(|Q|) * 2 + 1, then encode hard
        P = self._penalty_override
        if P is None:
            scale = float(np.abs(Q).max())
            P = scale * 2.0 + 1.0
        self._encode_hard(Q, P)

        # 3. Build provenance
        penalty_weights = self._penalty_weights(P)
        ir_hash         = self.ir.ir_hash()
        prov = QUBOProvenance(
            source               = "constraint_compiler",
            constraint_ir_hash   = ir_hash,
            policy_snapshot_hash = self._policy_snapshot,
            compiler_version     = _COMPILER_VERSION,
            penalty_weights      = penalty_weights,
            variable_map         = reg.all_labels,
        )

        return CompilerResult(
            Q            = Q,
            provenance   = prov,
            ir_dict      = self.ir.to_dict(),
            penalty      = P,
            variable_map = reg.all_labels,
            n_hard       = len(self.ir.hard),
            n_soft       = len(self.ir.soft),
            n_meta       = len(self.ir.meta),
        )

    # ── Soft encoding ─────────────────────────────────────────────────────────

    def _encode_soft(self, Q: np.ndarray) -> None:
        reg = self.ir.registry
        for c in self.ir.soft:
            if isinstance(c, (MinimizeCost, MinimizeSum)):
                weights = getattr(c, "weights", None) or [1.0] * len(c.vars)
                for v, w in zip(c.vars, weights):
                    i = reg.index(v)
                    Q[i, i] += w
            elif isinstance(c, MaximizeUtility):
                weights = c.weights or [1.0] * len(c.vars)
                for v, w in zip(c.vars, weights):
                    i = reg.index(v)
                    Q[i, i] -= w
            elif isinstance(c, PenalizePair):
                a, b = reg.index(c.var_a), reg.index(c.var_b)
                lo, hi = (a, b) if a <= b else (b, a)
                Q[lo, hi] += c.weight

    # ── Hard encoding ─────────────────────────────────────────────────────────

    def _encode_hard(self, Q: np.ndarray, P: float) -> None:
        reg = self.ir.registry
        for c in self.ir.hard:
            if isinstance(c, (ExactlyOne, ExactlyK)):
                k    = 1 if isinstance(c, ExactlyOne) else c.k
                idxs = [reg.index(v) for v in c.vars]
                # (Σ x_i - k)^2 = Σ x_i^2 + 2Σ_{i<j} x_i x_j - 2k Σ x_i + k^2
                # binary: x_i^2 = x_i
                for i in idxs:
                    Q[i, i] += P * (1 - 2 * k)
                for pi, i in enumerate(idxs):
                    for j in idxs[pi + 1:]:
                        lo, hi = (i, j) if i <= j else (j, i)
                        Q[lo, hi] += 2 * P

            elif isinstance(c, (AtMostOne, MutualExclusion)):
                # (Σ x_i)(Σ x_i - 1) / 2 penalty form: P * Σ_{i<j} x_i x_j
                idxs = [reg.index(v) for v in c.vars]
                for pi, i in enumerate(idxs):
                    for j in idxs[pi + 1:]:
                        lo, hi = (i, j) if i <= j else (j, i)
                        Q[lo, hi] += P

            elif isinstance(c, AtLeastOne):
                # (1 - Σ x_i)^2 only when sum < 1:
                # Cheap penalty: P * (1 - Σ x_i) = P - P Σ x_i (added to diag)
                # This keeps Q quadratic without slack variables.
                idxs = [reg.index(v) for v in c.vars]
                for i in idxs:
                    Q[i, i] -= P   # the -2 * 1 * x_i term (k=1, coeff = 1-2k = -1)

            elif isinstance(c, Implication):
                # x_a → x_b  ≡  x_a(1 - x_b) = 0  ≡  x_a - x_a x_b ≤ 0
                # penalty: P * (x_a - x_a x_b) = P * x_a * (1 - x_b)
                a, b = reg.index(c.antecedent), reg.index(c.consequent)
                Q[a, a] += P
                lo, hi = (a, b) if a <= b else (b, a)
                Q[lo, hi] -= P

            elif isinstance(c, ForbiddenPair):
                a, b = reg.index(c.var_a), reg.index(c.var_b)
                lo, hi = (a, b) if a <= b else (b, a)
                Q[lo, hi] += P

            elif isinstance(c, Equality):
                # (x_a - x_b)^2 = x_a + x_b - 2 x_a x_b
                a, b = reg.index(c.var_a), reg.index(c.var_b)
                Q[a, a] += P
                Q[b, b] += P
                lo, hi = (a, b) if a <= b else (b, a)
                Q[lo, hi] -= 2 * P

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _penalty_weights(self, P: float) -> dict[str, float]:
        """Build constraint_id → penalty-coefficient mapping for provenance."""
        pw: dict[str, float] = {}
        for c in self.ir.hard:
            pw[c.constraint_id] = P
        for c in self.ir.soft:
            pw[c.constraint_id] = 1.0   # objective coefficient; P not applied
        return pw


# ─── Self-contained demo ──────────────────────────────────────────────────────

def _demo() -> None:
    """
    Example: 3-job scheduling with conflicts.

    Variables: job_A, job_B, job_C  (assign to slot 0 or 1)
    Hard: exactly one job per slot → ExactlyOne([A, B, C]) — too many for
          this demo; instead: choose exactly 2 jobs, jobs A+B conflict.
    """
    from constraint_ir import (
        ConstraintIR, VariableRegistry,
        ExactlyK, ForbiddenPair, MinimizeCost, AuditRequired,
    )

    reg = VariableRegistry().declare("job_A", "job_B", "job_C")
    ir  = ConstraintIR(registry=reg, policy_version="v1-demo")
    ir.add_hard(ExactlyK("h1", vars=["job_A","job_B","job_C"], k=2,
                         description="schedule exactly 2 of 3 jobs"))
    ir.add_hard(ForbiddenPair("h2", var_a="job_A", var_b="job_B",
                               description="A and B conflict"))
    ir.add_soft(MinimizeCost("s1", vars=["job_A","job_B","job_C"],
                              weights=[3.0, 1.0, 2.0],
                              description="minimize total cost"))
    ir.add_meta(AuditRequired("m1", reason="scheduling policy §2"))

    compiler = QUBOCompiler(ir, policy_snapshot="demo-policy-sha256-deadbeef")
    result   = compiler.compile()

    print("=== QUBO Compiler Demo ===")
    print(f"  Variables        : {result.variable_map}")
    print(f"  IR hash          : {result.provenance.constraint_ir_hash}")
    print(f"  Penalty P        : {result.penalty:.2f}")
    print(f"  Hard constraints : {result.n_hard}")
    print(f"  Soft constraints : {result.n_soft}")
    print(f"  Meta constraints : {result.n_meta}")
    print(f"  Audit required   : {ir.requires_audit()}")
    print(f"  Fail-closed      : {ir.fail_closed()}")
    print(f"\n  Q matrix:\n{result.Q}")
    print(f"\n  Provenance: {result.provenance.to_dict()}")

    # --- connect to solver ---
    import sys, os
    sys.path.insert(0, os.path.dirname(__file__))
    from sbm_solver import SBMSolver, brute_force_qubo
    from solver_contract import SolverInput, SBMConfig

    inp    = result.to_solver_input(seed=0, problem_label="scheduling-demo")
    solver = SBMSolver(SBMConfig(n_reads=30), log_dir=None)
    out    = solver.solve(inp)
    bf_x, bf_val = brute_force_qubo(result.Q)

    print(f"\n  SBM  x          : {out.best_binary.tolist()}")
    print(f"  SBM  QUBO value : {out.best_qubo_value:.4f}")
    print(f"  BF   x          : {bf_x.tolist()}")
    print(f"  BF   QUBO value : {bf_val:.4f}")
    print(f"  gap             : {out.best_qubo_value - bf_val:+.4f}")
    print(f"  provenance_hash : {out.metadata.provenance_hash}")
    print(f"  result_hash     : {out.result_hash}")


if __name__ == "__main__":
    _demo()
