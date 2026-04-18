"""
phase14/solvers/solver_contract.py
─────────────────────────────────────────────────────────────────────────────
Formal contract for the SBM QUBO solver pipeline.

Defines the complete typed interface between:
  - Problem formulation  (SolverInput,  SBMConfig, ConstraintSet)
  - Solver results       (SolverOutput, ConvergenceSummary, RunMetadata)
  - Governance pipeline  (LedgerEntry)

Design principles:
  · All types are dataclasses — structurally typed and JSON-serialisable.
  · SolverOutput is self-auditable: every field needed for a post-hoc audit
    is embedded, including the result_hash.
  · LedgerEntry is a flattened projection of SolverOutput suitable for
    append-only JSONL audit ledgers.
  · No numpy arrays cross the ledger boundary — only Python primitives.
─────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

import numpy as np


# ─── Status ──────────────────────────────────────────────────────────────────

class SolverStatus(str, Enum):
    """Outcome classification of a single solver run."""
    OPTIMAL    = "OPTIMAL"     # BF-verified or objective gap == 0
    FEASIBLE   = "FEASIBLE"    # Constraints satisfied; optimality not proven
    INFEASIBLE = "INFEASIBLE"  # Best decoded solution violates ≥1 hard constraint
    ERROR      = "ERROR"       # Runtime exception during solve


# ─── Config ──────────────────────────────────────────────────────────────────

@dataclass
class SBMConfig:
    """
    Hyper-parameters for one SBM solve.
    seed here is the *default* seed; SolverInput.seed overrides it.
    """
    n_steps: int   = 1000   # integration steps per read
    dt:      float = 0.1    # symplectic Euler time step
    a0:      float = 1.0    # pump amplitude ceiling
    c0:      float = 0.5    # coupling scale factor
    n_reads: int   = 20     # independent restarts (best result is kept)

    def to_dict(self) -> dict:
        return {
            "n_steps": self.n_steps,
            "dt":      self.dt,
            "a0":      self.a0,
            "c0":      self.c0,
            "n_reads": self.n_reads,
        }


# ─── Constraints ─────────────────────────────────────────────────────────────

@dataclass
class ConstraintSet:
    """
    Hard linear constraints on the binary solution x ∈ {0,1}^n.

    Supported forms:
      A_eq   @ x == b_eq      (equality constraints)
      A_ineq @ x <= b_ineq    (inequality constraints)

    A violation is counted when:
      |Ax - b|  > tol  (equality)
      Ax − b    > tol  (inequality)
    """
    A_eq:   Optional[np.ndarray] = None
    b_eq:   Optional[np.ndarray] = None
    A_ineq: Optional[np.ndarray] = None
    b_ineq: Optional[np.ndarray] = None
    tol:    float                = 1e-6


# ─── QUBO provenance ─────────────────────────────────────────────────────────

@dataclass
class QUBOProvenance:
    """
    Audit record describing *how* the QUBO matrix was produced.

    Populated by the QUBO compiler; left as None when Q is provided directly.
    Without this field the audit trail is incomplete: the result can be
    verified but its origin cannot be traced back to a constitutionally
    sanctioned constraint IR.

    Fields
    ------
    source              : 'manual' | 'constraint_compiler' | 'external'
    constraint_ir_hash  : SHA-256[:16] of the ConstraintIR that produced Q
    policy_snapshot_hash: SHA-256[:16] of the policy/constitution in effect
    compiler_version    : e.g. 'qubo_compiler-1.0'
    penalty_weights     : dict mapping constraint_id → penalty coefficient
    variable_map        : list mapping QUBO column index → semantic label
    """
    source:               str                       = "manual"
    constraint_ir_hash:   Optional[str]             = None
    policy_snapshot_hash: Optional[str]             = None
    compiler_version:     Optional[str]             = None
    penalty_weights:      dict[str, float]          = field(default_factory=dict)
    variable_map:         list[str]                 = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "source":               self.source,
            "constraint_ir_hash":   self.constraint_ir_hash,
            "policy_snapshot_hash": self.policy_snapshot_hash,
            "compiler_version":     self.compiler_version,
            "penalty_weights":      self.penalty_weights,
            "variable_map":         self.variable_map,
        }


# ─── Solver input ────────────────────────────────────────────────────────────

@dataclass
class SolverInput:
    """
    Complete, self-contained specification of one solver invocation.
    The seed here overrides SBMConfig.seed when not None.
    """
    Q:              np.ndarray                  # n×n QUBO matrix
    config:         SBMConfig                   = field(default_factory=SBMConfig)
    seed:           Optional[int]               = None
    constraints:    Optional[ConstraintSet]     = None
    problem_label:  str                         = ""
    provenance:     Optional[QUBOProvenance]    = None


# ─── Output sub-types ────────────────────────────────────────────────────────

@dataclass
class ConvergenceSummary:
    """Statistics describing the convergence behaviour across all reads."""
    n_reads:       int
    n_steps:       int
    step_to_best:  int          # step index of best in the winning read
    best_per_read: list[float]  # best Ising energy achieved per read
    final_energy:  float        # best Ising energy across all reads
    energy_range:  float        # max − min of best_per_read (instability signal)
    stability:     float        # std-dev of best_per_read (lower = more stable)


@dataclass
class RunMetadata:
    """Identifiers and timing for one solver invocation."""
    solver_run_id:    str          # UUID4 — globally unique
    problem_hash:     str          # SHA-256[:16] of Q.tobytes()
    qubo_hash:        str          # SHA-256[:16] of symmetrised Q
    config_hash:      str          # SHA-256[:16] of config JSON
    provenance_hash:  str          # SHA-256[:16] of QUBOProvenance.to_dict(); '(manual)' if None
    seed:             int          # effective seed used
    timestamp_utc:    str          # ISO-8601 UTC
    elapsed_ms:       float
    solver_version:   str = "dSBM-1.0"


# ─── Primary output ──────────────────────────────────────────────────────────

@dataclass
class SolverOutput:
    """
    Full result of one SBMSolver.solve() call.
    Embeds everything needed for downstream governance / audit.
    """
    # Solution
    best_binary:     np.ndarray    # {0,1}^n   decoded from best Ising config
    best_spins:      np.ndarray    # {-1,+1}^n
    best_energy:     float         # Ising energy of best solution
    best_qubo_value: float         # x^T Q x  (original objective)

    # Feasibility verdict
    feasible:              bool
    constraint_violations: int
    violation_detail:      list[str]
    status:                SolverStatus

    # Traceability
    metadata:               RunMetadata
    convergence:            ConvergenceSummary
    energy_log:             list[float]        # per-step Ising energy (winning read)
    convergence_trace_path: Optional[str]      # absolute path to saved JSON trace

    # Audit anchor
    result_hash: str    # SHA-256[:20] of (run_id + binary + energy)

    # Provenance (echoed from SolverInput for downstream gate checks)
    provenance: Optional["QUBOProvenance"] = None


# ─── Ledger entry ─────────────────────────────────────────────────────────────

@dataclass
class LedgerEntry:
    """
    Flattened, numpy-free record for the append-only solver audit ledger.
    One LedgerEntry is produced per SolverOutput and written as one JSONL line.
    """
    solver_run_id:         str
    problem_hash:          str
    qubo_hash:             str
    config_hash:           str
    provenance_hash:       str      # QUBOProvenance hash; '(manual)' if not compiled
    seed:                  int
    timestamp_utc:         str
    n_variables:           int
    best_energy:           float
    best_qubo_value:       float
    constraint_violations: int
    convergence_summary:   dict     # ConvergenceSummary as plain dict
    status:                str      # SolverStatus.value
    result_hash:           str
    problem_label:         str = ""

    def to_dict(self) -> dict:
        return {
            "solver_run_id":         self.solver_run_id,
            "problem_hash":          self.problem_hash,
            "qubo_hash":             self.qubo_hash,
            "config_hash":           self.config_hash,
            "provenance_hash":       self.provenance_hash,
            "seed":                  self.seed,
            "timestamp_utc":         self.timestamp_utc,
            "n_variables":           self.n_variables,
            "best_energy":           self.best_energy,
            "best_qubo_value":       self.best_qubo_value,
            "constraint_violations": self.constraint_violations,
            "convergence_summary":   self.convergence_summary,
            "status":                self.status,
            "result_hash":           self.result_hash,
            "problem_label":         self.problem_label,
        }


# ─── Hashing utilities ───────────────────────────────────────────────────────

def hash_array(arr: np.ndarray, prefix_len: int = 16) -> str:
    """SHA-256 of the raw bytes of a numpy array."""
    return hashlib.sha256(np.ascontiguousarray(arr).tobytes()).hexdigest()[:prefix_len]


def hash_dict(d: dict, prefix_len: int = 16) -> str:
    """Deterministic SHA-256 of a JSON-serialisable dict."""
    s = json.dumps(d, sort_keys=True, default=str)
    return hashlib.sha256(s.encode()).hexdigest()[:prefix_len]


def hash_result(
    run_id: str,
    binary: np.ndarray,
    energy: float,
    prefix_len: int = 20,
) -> str:
    """Audit anchor: hash ties run_id, solution, and energy together."""
    payload = f"{run_id}:{binary.tolist()}:{energy:.10f}"
    return hashlib.sha256(payload.encode()).hexdigest()[:prefix_len]


# ─── Feasibility checker ─────────────────────────────────────────────────────

def check_feasibility(
    x: np.ndarray,
    constraints: Optional[ConstraintSet],
) -> tuple[bool, int, list[str]]:
    """
    Evaluate whether binary vector x satisfies all hard constraints.

    Returns
    -------
    feasible        : True iff n_violations == 0
    n_violations    : number of violated constraints
    violation_msgs  : human-readable per-constraint violation messages
    """
    if constraints is None:
        return True, 0, []

    msgs: list[str] = []

    if constraints.A_eq is not None and constraints.b_eq is not None:
        residuals = constraints.A_eq @ x - constraints.b_eq
        for i, r in enumerate(residuals):
            if abs(float(r)) > constraints.tol:
                msgs.append(
                    f"eq[{i}]: residual={float(r):+.6f}  (tol={constraints.tol})"
                )

    if constraints.A_ineq is not None and constraints.b_ineq is not None:
        lhs = constraints.A_ineq @ x
        for i, (lv, bv) in enumerate(zip(lhs, constraints.b_ineq)):
            if float(lv) > float(bv) + constraints.tol:
                msgs.append(
                    f"ineq[{i}]: {float(lv):.4f} > {float(bv):.4f}"
                    f"  (tol={constraints.tol})"
                )

    return len(msgs) == 0, len(msgs), msgs


# ─── SolverOutput → LedgerEntry projection ───────────────────────────────────

def output_to_ledger_entry(
    output:        SolverOutput,
    n_variables:   int,
    problem_label: str = "",
) -> LedgerEntry:
    """Flatten a SolverOutput into a LedgerEntry (no numpy arrays)."""
    c = output.convergence
    return LedgerEntry(
        solver_run_id         = output.metadata.solver_run_id,
        problem_hash          = output.metadata.problem_hash,
        qubo_hash             = output.metadata.qubo_hash,
        config_hash           = output.metadata.config_hash,
        seed                  = output.metadata.seed,
        timestamp_utc         = output.metadata.timestamp_utc,
        n_variables           = n_variables,
        best_energy           = output.best_energy,
        best_qubo_value       = output.best_qubo_value,
        constraint_violations = output.constraint_violations,
        convergence_summary   = {
            "n_reads":      c.n_reads,
            "n_steps":      c.n_steps,
            "step_to_best": c.step_to_best,
            "final_energy": c.final_energy,
            "energy_range": c.energy_range,
            "stability":    c.stability,
        },
        status                = output.status.value,
        result_hash           = output.result_hash,
        problem_label         = problem_label,
        provenance_hash       = output.metadata.provenance_hash,
    )
