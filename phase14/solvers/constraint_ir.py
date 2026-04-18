"""
phase14/solvers/constraint_ir.py
─────────────────────────────────────────────────────────────────────────────
Constraint IR (Intermediate Representation) v1.

This is the semantic layer between "human-readable policy / constitution" and
"QUBO matrix produced by the compiler".  All constraints are expressed here
as typed dataclasses before any numerical encoding.

The IR fixes *meaning* at authoring time.  Once a ConstraintIR is hashed and
logged, a change to the policy requires a new IR version — not a silent
coefficient tweak.  This is what makes the pipeline constitutionally auditable.

Constraint hierarchy:
  · Hard  — must be satisfied; violations → INFEASIBLE status
  · Soft  — penalised in the QUBO objective; violations are tracked
  · Meta  — non-numerical requirements (audit_required, human_review, …)

Supported hard constraint types (v1):

    exactly_one(vars)         Σ x_i = 1
    at_most_one(vars)         Σ x_i ≤ 1
    at_least_one(vars)        Σ x_i ≥ 1
    exactly_k(vars, k)        Σ x_i = k
    implication(a, b)         x_a = 1 → x_b = 1
    mutual_exclusion(vars)    Σ x_i ≤ 1   (alias for at_most_one, explicit intent)
    forbidden_pair(a, b)      x_a + x_b ≤ 1
    equality(a, b)            x_a = x_b

Supported soft constraint types (v1):

    minimize_cost(vars, weights)   minimize Σ w_i x_i
    maximize_utility(vars, weights) maximize Σ w_i x_i   (= minimize –Σ w_i x_i)
    penalize_pair(a, b, w)          penalize x_a x_b by w
    minimize_sum(vars)              minimize Σ x_i  (uniform cost)

Supported meta types (v1):

    audit_required(reason)    flag: this IR must appear in the ledger
    human_review(threshold)   flag: human review if n_violations > threshold
    fail_closed(scope)        flag: on ERROR, treat as INFEASIBLE
─────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Union


# ─── Variable registry ────────────────────────────────────────────────────────

@dataclass
class VariableRegistry:
    """
    Maps semantic labels to QUBO column indices (and back).

    Declare variables before authoring constraints; the compiler
    looks up indices from this registry.
    """
    _labels: list[str] = field(default_factory=list)

    def declare(self, *labels: str) -> "VariableRegistry":
        """Add one or more labels.  Duplicate labels raise ValueError."""
        for lbl in labels:
            if lbl in self._labels:
                raise ValueError(f"Variable '{lbl}' already declared")
            self._labels.append(lbl)
        return self

    def index(self, label: str) -> int:
        if label not in self._labels:
            raise KeyError(f"Unknown variable: '{label}'")
        return self._labels.index(label)

    def label(self, idx: int) -> str:
        return self._labels[idx]

    @property
    def n(self) -> int:
        return len(self._labels)

    @property
    def all_labels(self) -> list[str]:
        return list(self._labels)

    def to_dict(self) -> dict:
        return {"variables": self._labels}


# ─── Constraint type enums ────────────────────────────────────────────────────

class HardConstraintType(str, Enum):
    EXACTLY_ONE      = "exactly_one"
    AT_MOST_ONE      = "at_most_one"
    AT_LEAST_ONE     = "at_least_one"
    EXACTLY_K        = "exactly_k"
    IMPLICATION      = "implication"
    MUTUAL_EXCLUSION = "mutual_exclusion"
    FORBIDDEN_PAIR   = "forbidden_pair"
    EQUALITY         = "equality"


class SoftConstraintType(str, Enum):
    MINIMIZE_COST      = "minimize_cost"
    MAXIMIZE_UTILITY   = "maximize_utility"
    PENALIZE_PAIR      = "penalize_pair"
    MINIMIZE_SUM       = "minimize_sum"


class MetaConstraintType(str, Enum):
    AUDIT_REQUIRED = "audit_required"
    HUMAN_REVIEW   = "human_review"
    FAIL_CLOSED    = "fail_closed"


# ─── Hard constraints ─────────────────────────────────────────────────────────

@dataclass
class HardConstraint:
    """Base class for all hard constraints."""
    constraint_id: str
    type:          HardConstraintType
    description:   str = ""

    def to_dict(self) -> dict:
        raise NotImplementedError


@dataclass
class ExactlyOne(HardConstraint):
    """Exactly one of vars is 1: Σ x_i = 1"""
    vars: list[str] = field(default_factory=list)
    type: HardConstraintType = HardConstraintType.EXACTLY_ONE

    def to_dict(self) -> dict:
        return {"id": self.constraint_id, "type": self.type.value,
                "vars": self.vars, "description": self.description}


@dataclass
class AtMostOne(HardConstraint):
    """At most one of vars is 1: Σ x_i ≤ 1"""
    vars: list[str] = field(default_factory=list)
    type: HardConstraintType = HardConstraintType.AT_MOST_ONE

    def to_dict(self) -> dict:
        return {"id": self.constraint_id, "type": self.type.value,
                "vars": self.vars, "description": self.description}


@dataclass
class AtLeastOne(HardConstraint):
    """At least one of vars is 1: Σ x_i ≥ 1"""
    vars: list[str] = field(default_factory=list)
    type: HardConstraintType = HardConstraintType.AT_LEAST_ONE

    def to_dict(self) -> dict:
        return {"id": self.constraint_id, "type": self.type.value,
                "vars": self.vars, "description": self.description}


@dataclass
class ExactlyK(HardConstraint):
    """Exactly k of vars are 1: Σ x_i = k"""
    vars: list[str] = field(default_factory=list)
    k:    int       = 1
    type: HardConstraintType = HardConstraintType.EXACTLY_K

    def to_dict(self) -> dict:
        return {"id": self.constraint_id, "type": self.type.value,
                "vars": self.vars, "k": self.k, "description": self.description}


@dataclass
class Implication(HardConstraint):
    """If antecedent is 1 then consequent must be 1: x_a → x_b"""
    antecedent: str = ""
    consequent: str = ""
    type: HardConstraintType = HardConstraintType.IMPLICATION

    def to_dict(self) -> dict:
        return {"id": self.constraint_id, "type": self.type.value,
                "antecedent": self.antecedent, "consequent": self.consequent,
                "description": self.description}


@dataclass
class MutualExclusion(HardConstraint):
    """No two of vars can both be 1: Σ x_i ≤ 1 (explicit intent marker)"""
    vars: list[str] = field(default_factory=list)
    type: HardConstraintType = HardConstraintType.MUTUAL_EXCLUSION

    def to_dict(self) -> dict:
        return {"id": self.constraint_id, "type": self.type.value,
                "vars": self.vars, "description": self.description}


@dataclass
class ForbiddenPair(HardConstraint):
    """x_a and x_b cannot both be 1"""
    var_a: str = ""
    var_b: str = ""
    type: HardConstraintType = HardConstraintType.FORBIDDEN_PAIR

    def to_dict(self) -> dict:
        return {"id": self.constraint_id, "type": self.type.value,
                "var_a": self.var_a, "var_b": self.var_b,
                "description": self.description}


@dataclass
class Equality(HardConstraint):
    """x_a must equal x_b"""
    var_a: str = ""
    var_b: str = ""
    type: HardConstraintType = HardConstraintType.EQUALITY

    def to_dict(self) -> dict:
        return {"id": self.constraint_id, "type": self.type.value,
                "var_a": self.var_a, "var_b": self.var_b,
                "description": self.description}


# ─── Soft constraints ─────────────────────────────────────────────────────────

@dataclass
class SoftConstraint:
    """Base class for all soft constraints."""
    constraint_id: str
    type:          SoftConstraintType
    description:   str = ""

    def to_dict(self) -> dict:
        raise NotImplementedError


@dataclass
class MinimizeCost(SoftConstraint):
    """Minimize Σ w_i x_i"""
    vars:    list[str]   = field(default_factory=list)
    weights: list[float] = field(default_factory=list)
    type:    SoftConstraintType = SoftConstraintType.MINIMIZE_COST

    def to_dict(self) -> dict:
        return {"id": self.constraint_id, "type": self.type.value,
                "vars": self.vars, "weights": self.weights,
                "description": self.description}


@dataclass
class MaximizeUtility(SoftConstraint):
    """Maximize Σ w_i x_i  (encoded as minimize –Σ w_i x_i)"""
    vars:    list[str]   = field(default_factory=list)
    weights: list[float] = field(default_factory=list)
    type:    SoftConstraintType = SoftConstraintType.MAXIMIZE_UTILITY

    def to_dict(self) -> dict:
        return {"id": self.constraint_id, "type": self.type.value,
                "vars": self.vars, "weights": self.weights,
                "description": self.description}


@dataclass
class PenalizePair(SoftConstraint):
    """Add penalty w to QUBO diagonal+off-diagonal for x_a * x_b"""
    var_a:  str   = ""
    var_b:  str   = ""
    weight: float = 1.0
    type:   SoftConstraintType = SoftConstraintType.PENALIZE_PAIR

    def to_dict(self) -> dict:
        return {"id": self.constraint_id, "type": self.type.value,
                "var_a": self.var_a, "var_b": self.var_b, "weight": self.weight,
                "description": self.description}


@dataclass
class MinimizeSum(SoftConstraint):
    """Minimize Σ x_i (unit weights)"""
    vars: list[str] = field(default_factory=list)
    type: SoftConstraintType = SoftConstraintType.MINIMIZE_SUM

    def to_dict(self) -> dict:
        return {"id": self.constraint_id, "type": self.type.value,
                "vars": self.vars, "description": self.description}


# ─── Meta constraints ─────────────────────────────────────────────────────────

@dataclass
class MetaConstraint:
    """Non-numerical governance annotations."""
    constraint_id: str
    type:          MetaConstraintType
    description:   str = ""

    def to_dict(self) -> dict:
        raise NotImplementedError


@dataclass
class AuditRequired(MetaConstraint):
    """This problem MUST appear in the solver audit ledger."""
    reason: str = ""
    type:   MetaConstraintType = MetaConstraintType.AUDIT_REQUIRED

    def to_dict(self) -> dict:
        return {"id": self.constraint_id, "type": self.type.value,
                "reason": self.reason, "description": self.description}


@dataclass
class HumanReview(MetaConstraint):
    """Trigger human review if constraint_violations > threshold after solve."""
    threshold: int = 0
    reviewer:  str = ""
    type:      MetaConstraintType = MetaConstraintType.HUMAN_REVIEW

    def to_dict(self) -> dict:
        return {"id": self.constraint_id, "type": self.type.value,
                "threshold": self.threshold, "reviewer": self.reviewer,
                "description": self.description}


@dataclass
class FailClosed(MetaConstraint):
    """On ERROR or unexpected exception, treat result as INFEASIBLE."""
    scope: str = "global"
    type:  MetaConstraintType = MetaConstraintType.FAIL_CLOSED

    def to_dict(self) -> dict:
        return {"id": self.constraint_id, "type": self.type.value,
                "scope": self.scope, "description": self.description}


# ─── ConstraintIR (top-level container) ──────────────────────────────────────

AnyHardConstraint = Union[
    ExactlyOne, AtMostOne, AtLeastOne, ExactlyK,
    Implication, MutualExclusion, ForbiddenPair, Equality,
]
AnySoftConstraint = Union[
    MinimizeCost, MaximizeUtility, PenalizePair, MinimizeSum,
]
AnyMetaConstraint = Union[AuditRequired, HumanReview, FailClosed]


@dataclass
class ConstraintIR:
    """
    Complete typed constraint intermediate representation.

    This is the single artefact that:
      1. Fixes the semantic intent of the optimisation problem.
      2. Is hashed and embedded in QUBOProvenance before compilation.
      3. Is stored alongside the solver audit ledger entry.

    Authoring pattern:
        ir = ConstraintIR(registry=reg, policy_version="v1.0")
        ir.add_hard(ExactlyOne("h1", vars=["a", "b", "c"]))
        ir.add_soft(MinimizeCost("s1", vars=["a"], weights=[1.0]))
        ir.add_meta(AuditRequired("m1", reason="required by policy §3"))
        compiler = QUBOCompiler(ir)
        result = compiler.compile()
    """
    registry:       VariableRegistry
    policy_version: str                      = "v1.0"
    hard:           list[AnyHardConstraint]  = field(default_factory=list)
    soft:           list[AnySoftConstraint]  = field(default_factory=list)
    meta:           list[AnyMetaConstraint]  = field(default_factory=list)

    def add_hard(self, c: AnyHardConstraint) -> "ConstraintIR":
        self.hard.append(c)
        return self

    def add_soft(self, c: AnySoftConstraint) -> "ConstraintIR":
        self.soft.append(c)
        return self

    def add_meta(self, c: AnyMetaConstraint) -> "ConstraintIR":
        self.meta.append(c)
        return self

    def to_dict(self) -> dict:
        return {
            "policy_version": self.policy_version,
            "variables":      self.registry.all_labels,
            "hard":           [c.to_dict() for c in self.hard],
            "soft":           [c.to_dict() for c in self.soft],
            "meta":           [c.to_dict() for c in self.meta],
        }

    def ir_hash(self, prefix_len: int = 16) -> str:
        """Deterministic SHA-256[:prefix_len] of the serialised IR."""
        s = json.dumps(self.to_dict(), sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(s.encode()).hexdigest()[:prefix_len]

    def requires_audit(self) -> bool:
        return any(isinstance(m, AuditRequired) for m in self.meta)

    def fail_closed(self) -> bool:
        return any(isinstance(m, FailClosed) for m in self.meta)

    def human_review_threshold(self) -> Optional[int]:
        for m in self.meta:
            if isinstance(m, HumanReview):
                return m.threshold
        return None
