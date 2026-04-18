"""
phase14/solvers/compiler_governance.py
─────────────────────────────────────────────────────────────────────────────
Compiler Governance v1 — GovernedCompiler + coefficient policy enforcement.

Architecture
────────────
  CoeffPolicy          Typed representation of coefficient_policy.yaml.
  PolicyViolation      One constraint breach: code + message + details.
  PolicyViolationError Exception raised when >= 1 violation found.
  CompilerManifest     Immutable signing record committed to SolverInput.
                         snapshot_hash = SHA256(version ‖ policy_hash ‖ ir_hash ‖ ts)
  GovernedCompiler     Wraps QUBOCompiler; enforces policy; returns signed result.
  GovernedCompilerResult  CompilerResult + CompilerManifest.

Violation codes
───────────────
  PENALTY_BELOW_MIN       auto-P or fixed P < policy.hard_penalty.min
  PENALTY_ABOVE_MAX       auto-P or fixed P > policy.hard_penalty.max
  PENALTY_NOT_FINITE      P is NaN or Inf
  PENALTY_NEGATIVE        P < 0
  SOFT_WEIGHT_OVERFLOW    |w_i| > policy.soft_weight.max_abs
  HARD_NOT_DOMINANT       P ≤ max(|soft_coef|) when invariant enabled

Policy loading chain
────────────────────
  1. Explicit path passed to GovernedCompiler / load_policy()
  2. coefficient_policy.yaml next to this file (default)
  3. coefficient_policy.json next to this file (pyyaml-free fallback)
  4. Hardcoded defaults (fully offline / airgapped)
─────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import datetime
import hashlib
import json
import math
import os
from dataclasses import dataclass, field, asdict
from typing import Any, Optional

import numpy as np

from qubo_compiler import QUBOCompiler, CompilerResult
from solver_contract import QUBOProvenance, SolverInput, SBMConfig

# ─── Policy dataclasses ───────────────────────────────────────────────────────

@dataclass
class HardPenaltyPolicy:
    mode:             str   = "auto"    # "auto" | "fixed"
    fixed_value:      Optional[float] = None
    auto_multiplier:  float = 2.0
    min:              float = 1.0
    max:              float = 1000.0


@dataclass
class SoftWeightPolicy:
    max_abs: float = 100.0


@dataclass
class InvariantPolicy:
    hard_must_dominate_soft:  bool = True
    no_negative_penalty:      bool = True
    penalty_finite:           bool = True


@dataclass
class ProtectedClassPolicy:
    """
    Constraint class names that are NEVER compiled into QUBO terms.
    They are institution-level instruments checked outside the solver.
    """
    trust_boundary:           list = field(default_factory=lambda: ["TrustBoundary"])
    liability_chain:          list = field(default_factory=lambda: ["LiabilityChain"])
    constitutional_invariant: list = field(default_factory=lambda: ["AuditRequired", "FailClosed"])
    audit_required:           list = field(default_factory=lambda: ["AuditRequired", "HumanReview"])

    def all_protected(self) -> set:
        return (
            set(self.trust_boundary)
            | set(self.liability_chain)
            | set(self.constitutional_invariant)
            | set(self.audit_required)
        )


@dataclass
class CoeffPolicy:
    policy_version:    str                 = "coeff-policy-1.0"
    policy_authority:  str                 = "phase14-governance"
    hard_penalty:      HardPenaltyPolicy   = field(default_factory=HardPenaltyPolicy)
    soft_weight:       SoftWeightPolicy    = field(default_factory=SoftWeightPolicy)
    invariants:        InvariantPolicy     = field(default_factory=InvariantPolicy)
    protected_classes: ProtectedClassPolicy = field(default_factory=ProtectedClassPolicy)
    signed_by:         str                 = "policy-authority-phase14-v1"

    # source path (not part of hash)
    _source_path: str = field(default="(default)", compare=False, repr=False)

    def to_dict(self) -> dict:
        pc = self.protected_classes
        return {
            "policy_version":   self.policy_version,
            "policy_authority": self.policy_authority,
            "hard_penalty": {
                "mode":            self.hard_penalty.mode,
                "fixed_value":     self.hard_penalty.fixed_value,
                "auto_multiplier": self.hard_penalty.auto_multiplier,
                "min":             self.hard_penalty.min,
                "max":             self.hard_penalty.max,
            },
            "soft_weight": {
                "max_abs": self.soft_weight.max_abs,
            },
            "invariants": {
                "hard_must_dominate_soft": self.invariants.hard_must_dominate_soft,
                "no_negative_penalty":     self.invariants.no_negative_penalty,
                "penalty_finite":          self.invariants.penalty_finite,
            },
            "protected_classes": {
                "trust_boundary":           pc.trust_boundary,
                "liability_chain":          pc.liability_chain,
                "constitutional_invariant": pc.constitutional_invariant,
                "audit_required":           pc.audit_required,
            },
            "signed_by": self.signed_by,
        }

    def policy_hash(self, prefix_len: int = 16) -> str:
        """Deterministic SHA-256 hash of the policy (version-stable serialisation)."""
        raw = json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(raw.encode()).hexdigest()[:prefix_len]


# ─── Violation ───────────────────────────────────────────────────────────────

@dataclass
class PolicyViolation:
    code:    str           # e.g. "PENALTY_ABOVE_MAX"
    message: str           # human-readable
    details: dict = field(default_factory=dict)

    def __str__(self) -> str:
        return f"[{self.code}] {self.message}"


class PolicyViolationError(Exception):
    """Raised when GovernedCompiler.compile() detects policy violations."""
    def __init__(self, violations: list[PolicyViolation]):
        self.violations = violations
        summary = "; ".join(str(v) for v in violations)
        super().__init__(f"{len(violations)} policy violation(s): {summary}")


# ─── Manifest ────────────────────────────────────────────────────────────────

@dataclass
class CompilerManifest:
    """
    Signed, immutable record of one compilation event.
    snapshot_hash binds: compiler_version ‖ policy_hash ‖ ir_hash ‖ compiled_at_utc
    """
    snapshot_hash:    str   # commits to everything below
    ir_hash:          str
    policy_version:   str
    policy_hash:      str
    compiler_version: str
    compiled_at_utc:  str

    def to_dict(self) -> dict:
        return {
            "snapshot_hash":    self.snapshot_hash,
            "ir_hash":          self.ir_hash,
            "policy_version":   self.policy_version,
            "policy_hash":      self.policy_hash,
            "compiler_version": self.compiler_version,
            "compiled_at_utc":  self.compiled_at_utc,
        }


# ─── Governed result ─────────────────────────────────────────────────────────

@dataclass
class GovernedCompilerResult:
    """
    CompilerResult + governance manifest.
    All CompilerResult fields are forwarded for convenience.
    """
    base:     CompilerResult
    manifest: CompilerManifest

    # ── forward key fields ────────────────────────────────────────────────────
    @property
    def Q(self) -> np.ndarray:      return self.base.Q

    @property
    def provenance(self) -> QUBOProvenance: return self.base.provenance

    @property
    def variable_map(self) -> list[str]:    return self.base.variable_map

    @property
    def penalty(self) -> float:     return self.base.penalty

    @property
    def n_hard(self) -> int:        return self.base.n_hard

    @property
    def n_soft(self) -> int:        return self.base.n_soft

    @property
    def n_meta(self) -> int:        return self.base.n_meta

    def to_solver_input(
        self,
        config:        Optional[SBMConfig] = None,
        seed:          Optional[int]       = None,
        problem_label: str                 = "",
    ) -> SolverInput:
        return self.base.to_solver_input(
            config        = config,
            seed          = seed,
            problem_label = problem_label,
        )


# ─── Policy loader ────────────────────────────────────────────────────────────

_DEFAULT_POLICY_YAML = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "coefficient_policy.yaml",
)

_DEFAULT_POLICY_JSON = _DEFAULT_POLICY_YAML.replace(".yaml", ".json")


def load_policy(path: Optional[str] = None) -> CoeffPolicy:
    """
    Load a CoeffPolicy from YAML (preferred), JSON (fallback), or defaults.

    Resolution order:
      1. explicit ``path`` argument
      2. coefficient_policy.yaml next to this file
      3. coefficient_policy.json next to this file
      4. hardcoded defaults (CoeffPolicy())
    """
    candidates = []
    if path:
        candidates.append(path)
    candidates += [_DEFAULT_POLICY_YAML, _DEFAULT_POLICY_JSON]

    for p in candidates:
        if not os.path.exists(p):
            continue
        try:
            with open(p, "r", encoding="utf-8") as f:
                if p.endswith(".yaml") or p.endswith(".yml"):
                    try:
                        import yaml
                        data = yaml.safe_load(f)
                    except ImportError:
                        # pyyaml not available; skip YAML candidate
                        continue
                else:
                    data = json.load(f)
            return _dict_to_policy(data, source_path=p)
        except Exception:
            continue  # corrupt file → try next

    # All candidates failed → hardcoded defaults
    return CoeffPolicy(_source_path="(default)")


def _dict_to_policy(d: dict, source_path: str = "(dict)") -> CoeffPolicy:
    hp_d  = d.get("hard_penalty", {})
    sw_d  = d.get("soft_weight", {})
    inv_d = d.get("invariants", {})
    pc_d  = d.get("protected_classes", {})
    return CoeffPolicy(
        policy_version   = d.get("policy_version", "coeff-policy-1.0"),
        policy_authority = d.get("policy_authority", "phase14-governance"),
        hard_penalty     = HardPenaltyPolicy(
            mode             = hp_d.get("mode", "auto"),
            fixed_value      = hp_d.get("fixed_value"),
            auto_multiplier  = float(hp_d.get("auto_multiplier", 2.0)),
            min              = float(hp_d.get("min", 1.0)),
            max              = float(hp_d.get("max", 1000.0)),
        ),
        soft_weight      = SoftWeightPolicy(
            max_abs = float(sw_d.get("max_abs", 100.0)),
        ),
        invariants       = InvariantPolicy(
            hard_must_dominate_soft = bool(inv_d.get("hard_must_dominate_soft", True)),
            no_negative_penalty     = bool(inv_d.get("no_negative_penalty", True)),
            penalty_finite          = bool(inv_d.get("penalty_finite", True)),
        ),
        protected_classes = ProtectedClassPolicy(
            trust_boundary           = pc_d.get("trust_boundary",           ["TrustBoundary"]),
            liability_chain          = pc_d.get("liability_chain",          ["LiabilityChain"]),
            constitutional_invariant = pc_d.get("constitutional_invariant", ["AuditRequired", "FailClosed"]),
            audit_required           = pc_d.get("audit_required",           ["AuditRequired", "HumanReview"]),
        ),
        signed_by        = d.get("signed_by", "policy-authority-phase14-v1"),
        _source_path     = source_path,
    )


# ─── Governed compiler ───────────────────────────────────────────────────────

_COMPILER_VERSION = "qubo_compiler-1.0"


class GovernedCompiler:
    """
    Policy-enforcing QUBO compiler.

    Usage
    -----
    result = GovernedCompiler(ir).compile()
    # result.manifest.snapshot_hash is in result.provenance.policy_snapshot_hash

    Raises
    ------
    PolicyViolationError   if any policy invariant is violated
    """

    def __init__(
        self,
        ir,                               # ConstraintIR
        policy_path:     Optional[str]   = None,
        penalty_override: Optional[float] = None,
    ):
        from constraint_ir import ConstraintIR
        if not isinstance(ir, ConstraintIR):
            raise TypeError(f"ir must be ConstraintIR, got {type(ir)}")
        self.ir              = ir
        self.policy          = load_policy(policy_path)
        self._penalty_ov     = penalty_override

    # ── Public ────────────────────────────────────────────────────────────────

    def compile(self) -> GovernedCompilerResult:
        """
        Compile the IR into a governed QUBO result.

        Steps:
          1  Collect maximum |soft coefficient| to set penalty base.
          2  Check all soft weights against policy.soft_weight.max_abs.
          3  Compute governed penalty P (auto / fixed, clamped, validated).
          4  Check constitutional invariants.
          5  If violations → raise PolicyViolationError.
          6  Delegate to QUBOCompiler with governed P.
          7  Build and attach CompilerManifest; update provenance.
        """
        violations: list[PolicyViolation] = []

        # 1 + 2: soft coefficients
        max_soft_abs = self._max_abs_soft_coeff()
        violations += self._check_soft_weights()

        # 3: governed P
        P, pen_violations = self._compute_governed_penalty(max_soft_abs)
        violations += pen_violations

        # 4: invariants
        violations += self._check_invariants(P, max_soft_abs)

        # 5: raise on any violations
        if violations:
            raise PolicyViolationError(violations)

        # 6: delegate
        p_hash   = self.policy.policy_hash()
        base     = QUBOCompiler(
            self.ir,
            penalty          = P,
            policy_snapshot  = p_hash,
        ).compile()

        # 7: build manifest
        manifest = self._build_manifest(base, p_hash)

        # Patch provenance: policy_snapshot_hash → snapshot_hash (stronger binding)
        base.provenance.policy_snapshot_hash = manifest.snapshot_hash

        return GovernedCompilerResult(base=base, manifest=manifest)

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _max_abs_soft_coeff(self) -> float:
        """Return max |soft coefficient| across all soft constraints."""
        max_w = 0.0
        for c in self.ir.soft:
            weights = getattr(c, "weights", None)
            if weights:
                max_w = max(max_w, max(abs(w) for w in weights))
            w = getattr(c, "weight", None)
            if w is not None:
                max_w = max(max_w, abs(w))
        return max_w

    def _check_soft_weights(self) -> list[PolicyViolation]:
        vs: list[PolicyViolation] = []
        limit = self.policy.soft_weight.max_abs
        for c in self.ir.soft:
            cid = c.constraint_id
            weights = getattr(c, "weights", None)
            if weights:
                for i, w in enumerate(weights):
                    if abs(w) > limit:
                        vs.append(PolicyViolation(
                            code    = "SOFT_WEIGHT_OVERFLOW",
                            message = (f"soft constraint '{cid}' weight[{i}]={w:.4g} "
                                       f"exceeds max_abs={limit}"),
                            details = {"constraint_id": cid, "weight": w, "limit": limit},
                        ))
            w_single = getattr(c, "weight", None)
            if w_single is not None and abs(w_single) > limit:
                vs.append(PolicyViolation(
                    code    = "SOFT_WEIGHT_OVERFLOW",
                    message = (f"soft constraint '{cid}' weight={w_single:.4g} "
                               f"exceeds max_abs={limit}"),
                    details = {"constraint_id": cid, "weight": w_single, "limit": limit},
                ))
        return vs

    def _compute_governed_penalty(
        self,
        max_soft_abs: float,
    ) -> tuple[float, list[PolicyViolation]]:
        hp    = self.policy.hard_penalty
        vs: list[PolicyViolation] = []

        if self._penalty_ov is not None:
            P = float(self._penalty_ov)
        elif hp.mode == "fixed":
            if hp.fixed_value is None:
                vs.append(PolicyViolation(
                    code    = "PENALTY_BELOW_MIN",
                    message = "mode='fixed' but fixed_value is null",
                    details = {},
                ))
                P = hp.min
            else:
                P = float(hp.fixed_value)
        else:  # auto
            base = max(max_soft_abs, 1.0)
            P    = base * hp.auto_multiplier + 1.0

        # range checks
        if not math.isfinite(P):
            vs.append(PolicyViolation(
                code    = "PENALTY_NOT_FINITE",
                message = f"penalty P={P} is not finite",
                details = {"P": P},
            ))
        else:
            if P < 0:
                vs.append(PolicyViolation(
                    code    = "PENALTY_NEGATIVE",
                    message = f"penalty P={P:.4g} is negative",
                    details = {"P": P},
                ))
            if P < hp.min:
                vs.append(PolicyViolation(
                    code    = "PENALTY_BELOW_MIN",
                    message = f"penalty P={P:.4g} < policy.min={hp.min}",
                    details = {"P": P, "min": hp.min},
                ))
            if P > hp.max:
                vs.append(PolicyViolation(
                    code    = "PENALTY_ABOVE_MAX",
                    message = f"penalty P={P:.4g} > policy.max={hp.max}",
                    details = {"P": P, "max": hp.max},
                ))

        return P, vs

    def _check_invariants(
        self,
        P:            float,
        max_soft_abs: float,
    ) -> list[PolicyViolation]:
        inv = self.policy.invariants
        vs: list[PolicyViolation] = []

        if inv.penalty_finite and not math.isfinite(P):
            vs.append(PolicyViolation(
                code    = "PENALTY_NOT_FINITE",
                message = f"invariant penalty_finite violated: P={P}",
                details = {"P": P},
            ))
        if inv.no_negative_penalty and math.isfinite(P) and P < 0:
            vs.append(PolicyViolation(
                code    = "PENALTY_NEGATIVE",
                message = f"invariant no_negative_penalty violated: P={P:.4g}",
                details = {"P": P},
            ))
        if inv.hard_must_dominate_soft and math.isfinite(P) and max_soft_abs >= P:
            vs.append(PolicyViolation(
                code    = "HARD_NOT_DOMINANT",
                message = (
                    f"invariant hard_must_dominate_soft violated: "
                    f"P={P:.4g} ≤ max_soft={max_soft_abs:.4g}"
                ),
                details = {"P": P, "max_soft_abs": max_soft_abs},
            ))
        return vs

    def _build_manifest(
        self,
        base:    CompilerResult,
        p_hash:  str,
    ) -> CompilerManifest:
        now    = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
        ir_h   = self.ir.ir_hash()
        p_ver  = self.policy.policy_version
        c_ver  = _COMPILER_VERSION

        raw    = f"{c_ver}||{p_hash}||{ir_h}||{now}"
        snap_h = hashlib.sha256(raw.encode()).hexdigest()[:16]

        return CompilerManifest(
            snapshot_hash    = snap_h,
            ir_hash          = ir_h,
            policy_version   = p_ver,
            policy_hash      = p_hash,
            compiler_version = c_ver,
            compiled_at_utc  = now,
        )


# ─── Self-contained demo ──────────────────────────────────────────────────────

def _demo() -> None:
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from constraint_ir import (
        ConstraintIR, VariableRegistry,
        ExactlyK, ForbiddenPair, MinimizeCost, AuditRequired,
    )

    reg = VariableRegistry().declare("job_A", "job_B", "job_C")
    ir  = ConstraintIR(registry=reg, policy_version="v1-gov-demo")
    ir.add_hard(ExactlyK("h1", vars=["job_A","job_B","job_C"], k=2))
    ir.add_hard(ForbiddenPair("h2", var_a="job_A", var_b="job_B"))
    ir.add_soft(MinimizeCost("s1", vars=["job_A","job_B","job_C"], weights=[3.0, 1.0, 2.0]))
    ir.add_meta(AuditRequired("m1", reason="scheduling policy §2"))

    policy = load_policy()
    print("=== Compiler Governance Demo ===")
    print(f"  policy_version   : {policy.policy_version}")
    print(f"  policy_hash      : {policy.policy_hash()}")
    print(f"  policy source    : {policy._source_path}")
    print(f"  hard_penalty     : mode={policy.hard_penalty.mode} "
          f"mul={policy.hard_penalty.auto_multiplier} "
          f"range=[{policy.hard_penalty.min}, {policy.hard_penalty.max}]")
    print(f"  soft_weight max  : {policy.soft_weight.max_abs}")

    gov = GovernedCompiler(ir)
    result = gov.compile()

    print(f"\n  IR hash          : {result.manifest.ir_hash}")
    print(f"  policy_hash      : {result.manifest.policy_hash}")
    print(f"  snapshot_hash    : {result.manifest.snapshot_hash}")
    print(f"  compiled_at_utc  : {result.manifest.compiled_at_utc}")
    print(f"  penalty P        : {result.penalty:.2f}")
    print(f"  provenance.policy_snapshot_hash : {result.provenance.policy_snapshot_hash}")
    print(f"\n  Q matrix:\n{result.Q}")

    # Try to trigger a violation
    print("\n--- Triggering SOFT_WEIGHT_OVERFLOW ---")
    ir2 = ConstraintIR(registry=reg, policy_version="v1-bad")
    ir2.add_hard(ExactlyK("h1", vars=["job_A","job_B","job_C"], k=2))
    ir2.add_soft(MinimizeCost("s2", vars=["job_A","job_B","job_C"], weights=[150.0, 1.0, 2.0]))
    try:
        GovernedCompiler(ir2).compile()
        print("  ERROR: should have raised")
    except PolicyViolationError as e:
        print(f"  CAUGHT: {e}")


if __name__ == "__main__":
    _demo()
