"""
phase14/solvers/sbm_solver.py
─────────────────────────────────────────────────────────────────────────────
Discrete Simulated Bifurcation Machine (dSBM) — contracted solver module.

Algorithm : Goto et al. 2019, "Combinatorial optimization by simulating
            adiabatic bifurcations in nonlinear Hamiltonian systems",
            Science Advances 5, eaav2372

This module implements `SolverContract`:
  · Accepts  : SolverInput  (Q, SBMConfig, seed, ConstraintSet)
  · Returns  : SolverOutput (solution, feasibility verdict, metadata, hash)
  · Writes   : convergence trace JSON  → phase14/data/sbm_logs/
  · Provides : brute_force_qubo() for gap verification (n <= 20)
  · Provides : ascii_energy_plot() for terminal diagnostics

Governance hook: SolverOutput is passed to SolverLedger.append() to produce
an immutable audit-trail entry.
─────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import datetime
import json
import os
import time
import uuid
from typing import Optional

import numpy as np

from solver_contract import (
    SBMConfig,
    ConstraintSet,
    ConvergenceSummary,
    QUBOProvenance,
    RunMetadata,
    SolverInput,
    SolverOutput,
    SolverStatus,
    check_feasibility,
    hash_array,
    hash_dict,
    hash_result,
)

_SOLVER_VERSION = "dSBM-1.0"

# ─── QUBO ↔ Ising conversion ─────────────────────────────────────────────────

def qubo_to_ising(Q):
    """
    Convert QUBO  min  x^T Q x,  x in {0,1}^n
    to     Ising  min  -1/2 s^T J s - h^T s + offset,  s in {-1,+1}^n

    Substitution x_i = (1 + s_i) / 2 yields:
        J[i,j]  = -Q_sym[i,j] / 2       (off-diagonal; J diagonal = 0)
        h[i]    = -(1/2) * sum_j Q_sym[i,j]
        offset  = 1/2 * sum_i Q_sym[i,i]  +  1/2 * sum_{i<j} Q_sym[i,j]
    """
    n     = Q.shape[0]
    Q_sym = (Q + Q.T) / 2.0
    J      = np.zeros((n, n))
    h      = np.zeros(n)
    offset = 0.0
    for i in range(n):
        h[i]    = -0.5 * Q_sym[i].sum()
        offset += Q_sym[i, i] / 2.0
        for j in range(i + 1, n):
            J[i, j] = -Q_sym[i, j] / 2.0
            J[j, i] = -Q_sym[i, j] / 2.0
            offset += Q_sym[i, j] / 2.0
    return J, h, offset


def ising_energy(J, h, s):
    """Ising objective: E = -1/2 s^T J s - h^T s"""
    return float(-0.5 * (s @ J @ s) - h @ s)


def qubo_value(Q, x):
    """QUBO objective: x^T Q x"""
    return float(x @ Q @ x)


# ─── Core solver ─────────────────────────────────────────────────────────────

class SBMSolver:
    """
    Discrete Simulated Bifurcation Machine solver.

    Usage
    -----
    solver = SBMSolver()
    output = solver.solve(SolverInput(Q=my_qubo))
    """

    def __init__(self, config=None, log_dir=None):
        self.config  = config or SBMConfig()
        self.log_dir = log_dir

    def solve(self, inp):
        """Run dSBM on inp.Q.  Returns SolverOutput."""
        cfg = inp.config
        Q   = inp.Q
        n   = Q.shape[0]

        seed = inp.seed if inp.seed is not None else cfg.seed
        if seed is None:
            seed = int(time.time() * 1e6) & 0xFFFFFFFF
        rng = np.random.default_rng(seed)

        J, h, _offset = qubo_to_ising(Q)

        run_id  = str(uuid.uuid4())
        ts_utc  = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        t_start = time.perf_counter()

        best_energy_global = float("inf")
        best_spins_global  = np.ones(n)
        last_energy_log    = []
        all_read_best      = []

        for _read in range(cfg.n_reads):
            y = rng.uniform(-0.1, 0.1, n)
            x = np.zeros(n)
            best_energy_run = float("inf")
            best_spins_run  = np.where(y >= 0, 1.0, -1.0)
            energy_log      = []

            for step in range(cfg.n_steps):
                a_t  = cfg.a0 * step / cfg.n_steps
                x   += cfg.dt * (-(cfg.a0 - a_t) * y + cfg.c0 * (J @ y) + cfg.c0 * h)
                y   += cfg.dt * x
                overflow = np.abs(y) > 1.0
                if np.any(overflow):
                    y[overflow] = np.sign(y[overflow])
                    x[overflow] = 0.0
                s = np.where(y >= 0, 1.0, -1.0)
                e = ising_energy(J, h, s)
                energy_log.append(e)
                if e < best_energy_run:
                    best_energy_run = e
                    best_spins_run  = s.copy()

            all_read_best.append(best_energy_run)
            if best_energy_run < best_energy_global:
                best_energy_global = best_energy_run
                best_spins_global  = best_spins_run.copy()
                last_energy_log    = energy_log

        elapsed_ms = (time.perf_counter() - t_start) * 1000.0

        best_binary  = ((best_spins_global + 1) / 2).astype(int)
        best_qv      = qubo_value(Q, best_binary.astype(float))
        step_to_best = int(np.argmin(last_energy_log)) + 1

        feasible, n_viol, viol_msgs = check_feasibility(
            best_binary.astype(float), inp.constraints
        )

        status = SolverStatus.INFEASIBLE if n_viol > 0 else SolverStatus.FEASIBLE

        bpr = np.array(all_read_best)
        convergence = ConvergenceSummary(
            n_reads       = cfg.n_reads,
            n_steps       = cfg.n_steps,
            step_to_best  = step_to_best,
            best_per_read = all_read_best,
            final_energy  = best_energy_global,
            energy_range  = float(bpr.max() - bpr.min()),
            stability     = float(bpr.std()),
        )

        Q_sym  = (Q + Q.T) / 2.0
        prov_h = hash_dict(inp.provenance.to_dict()) if inp.provenance is not None else "(manual)"
        metadata = RunMetadata(
            solver_run_id  = run_id,
            problem_hash   = hash_array(Q),
            qubo_hash      = hash_array(Q_sym),
            config_hash    = hash_dict(cfg.to_dict()),
            provenance_hash= prov_h,
            seed           = seed,
            timestamp_utc  = ts_utc,
            elapsed_ms     = elapsed_ms,
            solver_version = _SOLVER_VERSION,
        )

        trace_path = self._save_trace(
            run_id=run_id, label=inp.problem_label, n=n,
            best_qv=best_qv, best_binary=best_binary,
            energy_log=last_energy_log, all_read_best=all_read_best,
            step_to_best=step_to_best, elapsed_ms=elapsed_ms,
        )

        r_hash = hash_result(run_id, best_binary, best_energy_global)

        return SolverOutput(
            best_binary            = best_binary,
            best_spins             = best_spins_global,
            best_energy            = best_energy_global,
            best_qubo_value        = best_qv,
            feasible               = feasible,
            constraint_violations  = n_viol,
            violation_detail       = viol_msgs,
            status                 = status,
            metadata               = metadata,
            convergence            = convergence,
            energy_log             = last_energy_log,
            convergence_trace_path = trace_path,
            result_hash            = r_hash,
            provenance             = inp.provenance,
        )

    def _save_trace(self, run_id, label, n, best_qv, best_binary,
                    energy_log, all_read_best, step_to_best, elapsed_ms):
        if self.log_dir is None:
            return None
        os.makedirs(self.log_dir, exist_ok=True)
        safe = (label or "unlabeled").lower().replace(" ", "_").replace("/", "-")
        path = os.path.join(self.log_dir, f"sbm_{safe}_{run_id[:8]}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({
                "solver":          _SOLVER_VERSION,
                "run_id":          run_id,
                "problem_label":   label,
                "n_variables":     n,
                "best_qubo_value": best_qv,
                "best_binary":     best_binary.tolist(),
                "step_to_best":    step_to_best,
                "elapsed_ms":      elapsed_ms,
                "all_read_best":   all_read_best,
                "energy_log":      energy_log,
            }, f, indent=2)
        return os.path.abspath(path)


# ─── Brute-force reference ────────────────────────────────────────────────────

def brute_force_qubo(Q):
    """Exhaustive 2^n search. n must be <= 20."""
    n = Q.shape[0]
    assert n <= 20, "brute_force_qubo: n must be <= 20"
    best_val = float("inf")
    best_x   = np.zeros(n, dtype=int)
    for mask in range(1 << n):
        x = np.array([(mask >> i) & 1 for i in range(n)], dtype=float)
        v = qubo_value(Q, x)
        if v < best_val:
            best_val = v
            best_x   = x.astype(int)
    return best_x, best_val


# ─── ASCII visualisation ─────────────────────────────────────────────────────

def ascii_energy_plot(energy_log, width=60, height=12, title="Energy convergence"):
    if not energy_log:
        return "(empty log)"
    n       = len(energy_log)
    e_min   = min(energy_log)
    e_max   = max(energy_log)
    e_range = e_max - e_min or 1.0
    cols    = [energy_log[int(c * n / width)] for c in range(width)]
    grid    = [[" "] * width for _ in range(height)]
    prev_row = None
    for c, val in enumerate(cols):
        row = int((e_max - val) / e_range * (height - 1))
        row = max(0, min(height - 1, row))
        grid[row][c] = "█"
        if prev_row is not None and abs(row - prev_row) > 1:
            for r in range(min(row, prev_row), max(row, prev_row) + 1):
                if grid[r][c] == " ":
                    grid[r][c] = "│"
        prev_row = row
    lines  = [f"  {title}"]
    lines += [f"  {e_max:+.3f} |" + "".join(grid[0])]
    for r in range(1, height - 1):
        lines += [f"         |" + "".join(grid[r])]
    lines += [f"  {e_min:+.3f} |" + "".join(grid[height - 1])]
    lines += [f"          +" + "-" * width]
    lines += [f"           0" + " " * (width // 2 - 4) + "step" + " " * (width // 2 - 4) + str(n)]
    return "\n".join(lines)


# ─── QUBO builders ───────────────────────────────────────────────────────────

def build_maxcut_qubo(n_nodes, edges):
    """Max-Cut QUBO: minimize sum_{(i,j)} w*(2*x_i*x_j - x_i - x_j)."""
    Q = np.zeros((n_nodes, n_nodes))
    for i, j, w in edges:
        Q[i, i] -= w
        Q[j, j] -= w
        Q[i, j] += w
        Q[j, i] += w
    return Q


def build_number_partition_qubo(numbers):
    """Number Partition QUBO: minimize (sum_S0 a_i - sum_S1 a_i)^2."""
    a = np.array(numbers, dtype=float)
    n = len(a)
    Q = np.zeros((n, n))
    for i in range(n):
        Q[i, i] = a[i] * (a[i] - a.sum())
        for j in range(i + 1, n):
            Q[i, j] = a[i] * a[j]
            Q[j, i] = a[i] * a[j]
    return Q


# ─── Demo ─────────────────────────────────────────────────────────────────────

def _run_demo(name, Q, solver, constraints=None, seed=42):
    n   = Q.shape[0]
    inp = SolverInput(Q=Q, config=solver.config, constraints=constraints,
                      seed=seed, problem_label=name)
    out = solver.solve(inp)

    if n <= 20:
        bf_x, bf_val = brute_force_qubo(Q)
        gap = out.best_qubo_value - bf_val
        if abs(gap) < 1e-6 and out.status == SolverStatus.FEASIBLE:
            out.status = SolverStatus.OPTIMAL
    else:
        bf_x, bf_val, gap = None, None, None

    print(f"\n{'='*68}")
    print(f"  {name}  (n={n})")
    print(f"{'='*68}")
    print(f"  status          : {out.status.value}")
    print(f"  best binary x   : {out.best_binary.tolist()}")
    print(f"  QUBO value      : {out.best_qubo_value:.4f}")
    print(f"  Ising energy    : {out.best_energy:.4f}")
    print(f"  feasible        : {out.feasible}"
          + (f"  ({out.constraint_violations} viol)" if not out.feasible else ""))
    print(f"  step to best    : {out.convergence.step_to_best} / {out.convergence.n_steps}")
    print(f"  stability (std) : {out.convergence.stability:.4f}")
    print(f"  elapsed         : {out.metadata.elapsed_ms:.1f} ms")
    print(f"  problem_hash    : {out.metadata.problem_hash}")
    print(f"  result_hash     : {out.result_hash}")

    if bf_val is not None:
        print(f"  BF best x       : {bf_x.tolist()}")
        print(f"  BF QUBO value   : {bf_val:.4f}")
        print(f"  gap (SBM - BF)  : {gap:+.4f}"
              + ("  (optimal)" if abs(gap) < 1e-6 else ""))

    for msg in out.violation_detail:
        print(f"  VIOLATION: {msg}")

    print()
    print(ascii_energy_plot(out.energy_log, title=f"Energy \u2014 {name}"))
    if out.convergence_trace_path:
        print(f"\n  trace -> {out.convergence_trace_path}")

    return out


def main():
    log_dir = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "data", "sbm_logs")
    )
    cfg    = SBMConfig(n_steps=1000, dt=0.1, a0=1.0, c0=0.5, n_reads=20)
    solver = SBMSolver(config=cfg, log_dir=log_dir)
    outputs = []
    labels  = []

    Q1 = build_maxcut_qubo(6, [(0,1,1),(1,2,1),(2,3,1),(3,4,1),(4,5,1),(5,0,1)])
    outputs.append(_run_demo("MaxCut 6-ring", Q1, solver, seed=42))
    labels.append("MaxCut 6-ring")

    edges8 = [(0,1,2),(0,3,1),(1,2,3),(1,4,1),(2,5,2),
              (3,4,2),(3,6,1),(4,5,1),(4,7,3),(5,7,2),(6,7,1)]
    Q2 = build_maxcut_qubo(8, edges8)
    outputs.append(_run_demo("MaxCut 8-node", Q2, solver, seed=42))
    labels.append("MaxCut 8-node")

    Q3 = build_number_partition_qubo([3, 1, 1, 2, 2, 1])
    outputs.append(_run_demo("Number Partition [3,1,1,2,2,1]", Q3, solver, seed=42))
    labels.append("Number Partition [3,1,1,2,2,1]")

    # Constrained example: force x[0]+x[1] == 1
    cset = ConstraintSet(
        A_eq = np.array([[1.0, 1.0, 0.0, 0.0, 0.0, 0.0]]),
        b_eq = np.array([1.0]),
    )
    outputs.append(_run_demo("MaxCut 6-ring (x0+x1==1)", Q1, solver, constraints=cset, seed=42))
    labels.append("MaxCut 6-ring (constrained)")

    print(f"\n{'='*68}")
    print(f"  {'Example':<36} {'Status':<12} {'QUBO val':>9} {'#viol':>5}")
    print(f"  {'-'*36} {'-'*12} {'-'*9} {'-'*5}")
    for lbl, o in zip(labels, outputs):
        print(f"  {lbl:<36} {o.status.value:<12} {o.best_qubo_value:>9.4f} "
              f"{o.constraint_violations:>5}")
    print(f"{'='*68}\n")


if __name__ == "__main__":
    main()