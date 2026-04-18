"""
phase14/solvers/smoke_test_institution.py
─────────────────────────────────────────────────────────────────────────────
Institutional governance smoke test — verifies:

  T1  CompilerManifestLedger — APPROVED event written correctly
  T2  CompilerManifestLedger — REJECTED + VIOLATION events on policy break
  T3  Ledger integrity_check — no tampered entries
  T4  PolicyLineage — ACTIVATED / SUPERSEDED / ROLLED_BACK chain
  T5  PolicyLineage integrity_check — no tampered entries
  T6  protected_classes loaded from YAML
  T7  policy_hash changes when protected_classes changes
─────────────────────────────────────────────────────────────────────────────
"""

import sys, os, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ledger_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ledger")
sys.path.insert(0, ledger_dir)

from constraint_ir import (
    ConstraintIR, VariableRegistry,
    ExactlyK, ForbiddenPair, MinimizeCost, AuditRequired, HumanReview,
)
from compiler_governance import (
    GovernedCompiler, load_policy, PolicyViolationError,
    CoeffPolicy, HardPenaltyPolicy, SoftWeightPolicy, InvariantPolicy,
    ProtectedClassPolicy,
)
from compiler_manifest_ledger import CompilerManifestLedger
from policy_lineage import PolicyLineage

_PASS = "PASS"
_FAIL = "FAIL"
results = []

def _make_ir(weights=(3.0, 1.0, 2.0)):
    reg = VariableRegistry().declare("job_A", "job_B", "job_C")
    ir  = ConstraintIR(registry=reg, policy_version="v1-inst-smoke")
    ir.add_hard(ExactlyK("h1", vars=["job_A","job_B","job_C"], k=2))
    ir.add_hard(ForbiddenPair("h2", var_a="job_A", var_b="job_B"))
    ir.add_soft(MinimizeCost("s1", vars=["job_A","job_B","job_C"], weights=list(weights)))
    ir.add_meta(AuditRequired("m1", reason="test policy"))
    ir.add_meta(HumanReview("m2", threshold=0, reviewer="QA"))
    return reg, ir

print("═══ Institutional Governance Smoke Tests ════════════════════════════")

with tempfile.TemporaryDirectory() as tmpdir:
    comp_ledger_path = os.path.join(tmpdir, "compiler_ledger.jsonl")
    pol_ledger_path  = os.path.join(tmpdir, "policy_lineage.jsonl")

    # ── T1: CompilerManifestLedger APPROVED ───────────────────────────────────
    print("\n── T1: CompilerManifestLedger — APPROVED event ──────────────────────")
    try:
        reg, ir1 = _make_ir()
        gov  = GovernedCompiler(ir1)
        res1 = gov.compile()

        cl = CompilerManifestLedger(comp_ledger_path)
        e  = cl.record_approved(res1)

        ok = (
            e.event_type   == "APPROVED"
            and e.snapshot_hash == res1.manifest.snapshot_hash
            and e.policy_hash   == res1.manifest.policy_hash
            and e.n_hard        == res1.n_hard
            and e.entry_hash    is not None
        )
        print(f"  event_type    : {e.event_type}")
        print(f"  snapshot_hash : {e.snapshot_hash}")
        print(f"  policy_hash   : {e.policy_hash}")
        print(f"  n_hard        : {e.n_hard}")
        status = _PASS if ok else _FAIL
        print(f"  → T1: {status}")
        results.append(("T1 APPROVED event", status))
    except Exception as ex:
        print(f"  ERROR: {ex}")
        results.append(("T1 APPROVED event", _FAIL))


    # ── T2: CompilerManifestLedger REJECTED + VIOLATION ───────────────────────
    print("\n── T2: CompilerManifestLedger — REJECTED + VIOLATION events ─────────")
    try:
        reg, ir2 = _make_ir(weights=[150.0, 1.0, 2.0])
        policy   = load_policy()
        cl       = CompilerManifestLedger(comp_ledger_path)
        try:
            GovernedCompiler(ir2).compile()
            print("  ERROR: no exception raised")
            results.append(("T2 REJECTED events", _FAIL))
        except PolicyViolationError as exc:
            entries = cl.record_rejected(exc, ir2, policy, "qubo_compiler-1.0")
            rej_e   = entries[0]
            viol_es = entries[1:]
            ok = (
                rej_e.event_type == "REJECTED"
                and len(viol_es) == len(exc.violations)
                and all(v.event_type == "VIOLATION" for v in viol_es)
                and all(v.parent_id  == rej_e.event_id for v in viol_es)
            )
            print(f"  REJECTED entry : {rej_e.event_id}")
            print(f"  VIOLATION entries: {[v.violation_code for v in viol_es]}")
            status = _PASS if ok else _FAIL
            print(f"  → T2: {status}")
            results.append(("T2 REJECTED events", status))
    except Exception as ex:
        print(f"  ERROR: {ex}")
        results.append(("T2 REJECTED events", _FAIL))


    # ── T3: Integrity check — no tampered entries ─────────────────────────────
    print("\n── T3: Ledger integrity_check ───────────────────────────────────────")
    try:
        cl   = CompilerManifestLedger(comp_ledger_path)
        bad  = cl.integrity_check()
        ok   = len(bad) == 0
        all_entries = cl.load_all()
        print(f"  Total entries : {len(all_entries)}")
        print(f"  Tampered      : {bad or '(none)'}")
        print(f"  → T3: {_PASS if ok else _FAIL}")
        results.append(("T3 Integrity check", _PASS if ok else _FAIL))
    except Exception as ex:
        print(f"  ERROR: {ex}")
        results.append(("T3 Integrity check", _FAIL))


    # ── T4: PolicyLineage chain ────────────────────────────────────────────────
    print("\n── T4: PolicyLineage — ACTIVATED / SUPERSEDED / ROLLED_BACK ────────")
    try:
        pol_v1 = load_policy()   # coeff-policy-1.0

        # Synthesise a "v2" by cloning with changed multiplier
        pol_v2 = CoeffPolicy(
            policy_version   = "coeff-policy-2.0",
            policy_authority = pol_v1.policy_authority,
            hard_penalty     = HardPenaltyPolicy(
                mode            = "auto",
                auto_multiplier = 3.0,
                min             = 1.0,
                max             = 2000.0,
            ),
            soft_weight      = pol_v1.soft_weight,
            invariants       = pol_v1.invariants,
            protected_classes= pol_v1.protected_classes,
            signed_by        = "policy-authority-phase14-v2",
        )

        lin = PolicyLineage(pol_ledger_path)
        e_act  = lin.activate(pol_v1, reason="initial deployment")
        e_sup  = lin.supersede(pol_v2, pol_v1, reason="penalty range widened §3")
        e_roll = lin.rollback(pol_v1, pol_v2, reason="P-overflow incident ref#77")

        chain = lin.full_chain()
        ok = (
            len(chain) == 3
            and chain[0]["event"]           == "ACTIVATED"
            and chain[1]["event"]           == "SUPERSEDED"
            and chain[1]["supersedes_hash"] == pol_v1.policy_hash()
            and chain[2]["event"]           == "ROLLED_BACK"
            and chain[2]["rolled_back_from"] == pol_v2.policy_hash()
            and lin.current_policy_hash()   == pol_v1.policy_hash()
        )
        print(f"  Events        : {[e['event'] for e in chain]}")
        print(f"  supersedes    : {chain[1]['supersedes_hash']}")
        print(f"  rolled_back   : {chain[2]['rolled_back_from']}")
        print(f"  current head  : {lin.current_policy_hash()}")
        status = _PASS if ok else _FAIL
        print(f"  → T4: {status}")
        results.append(("T4 PolicyLineage chain", status))
    except Exception as ex:
        import traceback; traceback.print_exc()
        print(f"  ERROR: {ex}")
        results.append(("T4 PolicyLineage chain", _FAIL))


    # ── T5: PolicyLineage integrity ───────────────────────────────────────────
    print("\n── T5: PolicyLineage integrity_check ────────────────────────────────")
    try:
        lin  = PolicyLineage(pol_ledger_path)
        bad  = lin.integrity_check()
        ok   = len(bad) == 0
        print(f"  Tampered      : {bad or '(none)'}")
        print(f"  → T5: {_PASS if ok else _FAIL}")
        results.append(("T5 Lineage integrity", _PASS if ok else _FAIL))
    except Exception as ex:
        print(f"  ERROR: {ex}")
        results.append(("T5 Lineage integrity", _FAIL))


# ── T6: protected_classes loaded from YAML ────────────────────────────────────
print("\n── T6: protected_classes loaded from YAML ───────────────────────────")
try:
    pol = load_policy()
    pc  = pol.protected_classes
    ok  = (
        "AuditRequired" in pc.constitutional_invariant
        and "FailClosed"    in pc.constitutional_invariant
        and "HumanReview"   in pc.audit_required
        and "TrustBoundary" in pc.trust_boundary
    )
    print(f"  constitutional_invariant : {pc.constitutional_invariant}")
    print(f"  audit_required           : {pc.audit_required}")
    print(f"  trust_boundary           : {pc.trust_boundary}")
    print(f"  all_protected()          : {sorted(pc.all_protected())}")
    status = _PASS if ok else _FAIL
    print(f"  → T6: {status}")
    results.append(("T6 Protected classes YAML", status))
except Exception as ex:
    print(f"  ERROR: {ex}")
    results.append(("T6 Protected classes YAML", _FAIL))


# ── T7: policy_hash changes when protected_classes changes ────────────────────
print("\n── T7: policy_hash changes on protected_classes mutation ────────────")
try:
    pol_a = load_policy()
    h_a   = pol_a.policy_hash()

    # Mutate: add a new type to trust_boundary
    pol_b = CoeffPolicy(
        policy_version    = pol_a.policy_version,
        policy_authority  = pol_a.policy_authority,
        hard_penalty      = pol_a.hard_penalty,
        soft_weight       = pol_a.soft_weight,
        invariants        = pol_a.invariants,
        protected_classes = ProtectedClassPolicy(
            trust_boundary           = pol_a.protected_classes.trust_boundary + ["LiabilityBoundary"],
            liability_chain          = pol_a.protected_classes.liability_chain,
            constitutional_invariant = pol_a.protected_classes.constitutional_invariant,
            audit_required           = pol_a.protected_classes.audit_required,
        ),
        signed_by         = pol_a.signed_by,
    )
    h_b = pol_b.policy_hash()

    ok = h_a != h_b
    print(f"  hash(original) : {h_a}")
    print(f"  hash(mutated)  : {h_b}")
    print(f"  hashes differ  : {ok}")
    status = _PASS if ok else _FAIL
    print(f"  → T7: {status}")
    results.append(("T7 Hash sensitivity", status))
except Exception as ex:
    print(f"  ERROR: {ex}")
    results.append(("T7 Hash sensitivity", _FAIL))


# ── Summary ───────────────────────────────────────────────────────────────────
print("\n═══ Results ═════════════════════════════════════════════════════════")
all_pass = True
for name, status in results:
    icon = "✓" if status == _PASS else "✗"
    print(f"  {icon}  {name:<35} {status}")
    if status != _PASS:
        all_pass = False

print(f"\n  Institution smoke test: {'ALL PASS' if all_pass else 'FAILURES PRESENT'}")
