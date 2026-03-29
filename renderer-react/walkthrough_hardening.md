# Hardening Report & Submission Narrative

> [!NOTE]
> The `renderer-react` assets in this repository are retained as demo/reference UI components that support operational walkthroughs and review flows. They are not treated as a standalone production application boundary inside `project-manuals`.

## 1. Adversarial Patch Replay Results

The core state logic was stress-tested against four network failure scenarios to ensure "Physical Irreversibility" and state consistency.

### Hardening Evidence Table (Clean-Room Verified)

| Test Case | Scenario | Core Match? | Rejected | Quarantined | Result |
|-----------|----------|-------------|----------|-------------|--------|
| **REPLAY_A** | Baseline (Strict Order) | **YES** | 0 | 0 | **PASS** |
| **REPLAY_B** | Network Jitter (Shuffled) | **YES** | 45 | 0 | **PASS** |
| **REPLAY_C** | Idempotency (Duplicates) | **YES** | 20 | 0 | **PASS** |
| **REPLAY_D** | Mixed RunID Injection | **NO_MUTATE**| 0 | 1 | **BOOT_ISOLATED** |

**Quantitative Telemetry Summary:**

- **Reorder Rejections (Test B):** 45
- **Duplicate Rejections (Test C):** 20
- **Quarantine Detections (Test D):** 1

> [!NOTE]
> Replay B and C rejections are intentional: the system drops patches that arrive with a `seq` less than or equal to the currently processed `lastSeq`, ensuring the state never "rolls back" out of order.

---

# 🔥 Devpost Submission: Live Agents — Sovereign Incident Infrastructure

### Elevator Pitch

Live Agents is not just an app; it is the **"Sensory Extension" (感覚器官の拡張)** of Sovereign OS. It transforms chaotic production failures into a deterministic recovery flow — powered by the Gemini Multimodal Live API to provide **Constraint-Based Intent Estimation (制約付き意図推定)** in the most hostile environments.

---

## 🏗 Concept: Extending Civilization Infrastructure

**これは単なるアプリ開発ではなく、Sovereign OSの「感覚器官」の拡張である。**

In critical infrastructure, failure is not an option, but fragmented information is a reality. Live Agents provides:

1. **Observability (2D/3D Visualization)**: Logical topology (2D) meets spatial cognition (3D).
2. **Gate Control (IAM & Logic)**: Causal execution gating that prevents unauthorized mutation.
3. **Auditability (Logging)**: Every decision anchored to an immutable ledger (Google Cloud Logging).

---

## 👄 The "Wow" Factor: Silent Mode Interface

**カメラを見つめ、声を出さずにコマンドを送る (Lip Reading) — The One-Shot "Magic"**

We solve the "Fog of War" through a multimodal fail-safe:

- **Accessibility**: Enables SREs with vocal impairments (e.g., ALS) to command production.
- **Data Centers**: Operates reliably under deafening hardware noise.
- **Disaster Zones**: Enables silent, high-stakes command execution.

---

## 🧠 The Solution: Constraint-Based Intent Estimation

**完全な読唇ではなく、「制約付き意図推定」で勝つ。**

Input is often incomplete. Live Agents uses Gemini to bridge the gap:

1. **Input**: Extract lip region from camera frames (MediaPipe).
2. **Context**: Inject "Top 5 Protocol Candidates" based on system state.
3. **Inference**: Gemini interprets movement + context to resolve intent.
**Result: 劇的な精度向上 (Dramatic Accuracy Improvement)**

*“入力が不完全でも、構造で補正する知性 (Intelligence that corrects even when input is incomplete)”*

---

## 🏗 Architecture: Single Source of Truth

**WorldState Patch Protocol** connects the Backend (Cloud Run) to the Renderers:

- **2D Dynamic Topology (監査の主戦力)**: Real-time React Flow visualization of causal chains and health.
- **3D Spatial Digital Twin (物理的な資産管理の演出)**: Abstract space (Spheres/Cubes) blast-radius cognition via React Three Fiber, utilizing the Live Agent state directly.

Every mutation is a **signed patch** against the WorldState, ensuring that regardless of network jitter, the system converges to a single reality.

---

## ⚖️ Final Verification

**“The agent is incapable of executing outside a deterministic, audited, two-factor-gated action path; all failures degrade to safe-mode with explicit operator visibility.”**

This is not a chatbot. This is the **Accountable Operational Layer** for the next generation of civilization infrastructure.
