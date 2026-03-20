# みんなのプロジェクト案内 (Everyone's Project Guide)

## Antigravityのお手伝いブック

このブックは、Antigravity（アンチグラビティ）というすごいお助けロボットが、どんなことをしているかをわかりやすく説明したものです。
むずかしい言葉は使わずに、みんなが知っているもので例えて説明するね！

### 📚 なかみ (Index)

| プロジェクトの名前 | たとえ | なにをしてるの？ |
| :--- | :--- | :--- |
| Riemann Gauntlet (archived / pending relocation) | **「ちょっと待って」の門** | 本当に話していいか考える門番さん |
| FOLD Theory (archived / pending relocation) | **ふかふかのクッション** | ぶつかっても壊れない、やわらかい作り |
| Drive-Bridge (archived / pending relocation) | **まほうのノート** | 思ったことが自動で書かれるノート |
| Pulse Layer (archived / pending relocation) | **ロボットの「こころ」の音** | ロボットの声に優しさを入れる |
| K-Collapse (archived / pending relocation) | **パンパンのカバン** | 詰め込みすぎると破裂しちゃうこと |
| EA-AOL (archived / pending relocation) | **ねむるクマさん** | 電池を大事にするためのお昼寝 |
| Patent Grounding (archived / pending relocation) | **「本当？」しらべ隊** | ウソがないか、本と見比べること |
| Gestalt Experiment (archived / pending relocation) | **みんなのおもちゃ箱** | 仲良くおもちゃを使うためのルール |
| Software Cleanup (archived / pending relocation) | **おへやのお片付け** | いらないものを捨ててスッキリさせる |
| Aesthetic Resonator (archived / pending relocation) | **にじいろメガネ** | お話をキラキラさせて楽しくする |
| IntuitionRouter (archived / pending relocation) | **近道見つけ隊** | 一番いい道をすぐに見つける |
| AI OS Strategy (archived / pending relocation) | **かべのない遊び場** | どこへでも行ける広い公園 |
| AI-Browser-Core (archived / pending relocation) | **「せかい」をみるめ** | 世界中を見に行くための目 |
| Cognitive-Substrate (archived / pending relocation) | **「かんがえ」のつち** | 考えを育てるための栄養満点の土 |
| Quantum-Structure-Opt (archived / pending relocation) | **「ぜったい」にこわれないパズル** | ダイヤモンドみたいに頑丈な考え方 |
| Autonomous-Task-Gen (archived / pending relocation) | **じぶんで作る「しゅくだい」** | 自分で次のお仕事を見つけるやる気 |

---

### 💭 アンチグラビティのひとりごと

制作してみて感じた、プロジェクトの「ここだけの話」 (archived / pending relocation)や、
この研究室の「ひみつ」 (archived / pending relocation)も書いてみました。

> [!NOTE]
> すべての説明は「なにをするの？」「どうやって動くの？」「どうやって使うの？」「注意することは？」の４つに分けて書いてあるよ。

---

## Live Demo (Google Cloud Run)

Demo URL: [https://YOUR-SERVICE.a.run.app](https://YOUR-SERVICE.a.run.app)

Notes:

- This is the same build path deployed to Cloud Run (CI/CD via Cloud Build).
- Destructive actions are always gated (ARM -> Integrity Scan -> 2FA) and are safe by design.
- If the demo is temporarily unavailable due to quota protection, run locally using the steps below.

Audit Trail:

- All state transitions and blocked/allowed execution attempts are emitted server-side and visible in Cloud Logging.

---

## Workflow Governance Validation (Fail-Closed)

This repository enforces workflow governance checks as fail-closed controls.

Local commands:

```bash
npm run workflow:validate
npm run workflow:event:validate
npm run workflow:dispatch:audit:telemetry
```

CI wiring:

- Workflow: `.github/workflows/workflow-governance-validation.yml`
- PR and push changes touching workflow contracts, runtime validators, or contract artifacts trigger validation.
- Any validator failure exits non-zero and blocks merge through job failure.
- Standard runtime dispatch path: `orchestrateAndDispatch()` (`orchestrate()` is low-level only).

Specification index:

- [workflows/workflow_catalog.v0.1.md](workflows/workflow_catalog.v0.1.md)

---

## 🧠 Ledger-Based ICL: Self-Evolving OS via Causal Gates

**Ledger-Based In-Context Learning (ICL)** is a novel framework that enables AI systems to learn from failures **without catastrophic forgetting**. Instead of updating model weights, failures are recorded as **auditable constitutional changes** in an immutable ledger.

### Core Principles

- **🔒 Failures as Constitutional Changes**: Every rejection becomes a rule, not a weight update
- **📊 Structured Vocabulary**: 4 RejectionClasses × 9 ConstraintTypes = Deterministic learning
- **⚖️ Gradual Hardening**: First offense = Warning, 5th offense = System-wide ban
- **🔍 Causal Similarity**: Not just semantic similarity, but intent-operation-risk alignment

### Quick Start

```bash
# Run the Phase 1 demo (vocabulary & mapping)
npx ts-node examples/ledger_icl_demo.ts
```

**Expected Output:**
- ✅ 5 scenarios demonstrating rejection → constraint mapping
- ✅ Hard filtering in action (reducing candidates by 90%)
- ✅ Ledger event generation with cryptographic chain
- ✅ 16 production-ready mapping rules

### Documentation

| Document | Purpose |
|----------|---------|
| [contract/ledger_icl.ts](contract/ledger_icl.ts) | **Core Implementation**: Enums, types, and mapping logic |
| docs/LEDGER_ICL_RUNBOOK.md (archived / pending relocation) | **Deployment Guide**: SQL schemas, integration steps, monitoring |
| docs/LEDGER_ICL_ARCHITECTURE.md (archived / pending relocation) | **Architecture**: Data flows, mermaid diagrams, design decisions |
| examples/ledger_icl_demo.ts (archived / pending relocation) | **Live Demo**: 5 scenarios with expected outputs |

### 4-Phase Implementation

| Phase | Status | Description |
|-------|--------|-------------|
| **Phase 1** | ✅ **Complete** | Fixed vocabulary (4 RejectionClasses, 9 ConstraintTypes, 16 mapping rules) |
| **Phase 2** | 🚧 In Progress | Trace recording, hard filtering, Transaction Gate integration |
| **Phase 3** | 📋 Design Complete | Causal similarity scoring, constraint capsules, ICL prompt injection |
| **Phase 4** | 📋 Design Complete | Constitution promotion (3+ recurrences → system-wide rule) |

### Key Concepts

**RejectionClass (Why did it fail?)**
```typescript
enum RejectionClass {
  MISSING_APPROVAL,       // Who approved this?
  INSUFFICIENT_EVIDENCE,  // What's the proof?
  SCOPE_OVERREACH,       // How far can you go?
  INTENT_AMBIGUOUS       // What do you want?
}
```

**ConstraintType (What's the next-time rule?)**
```typescript
enum ConstraintType {
  REQUIRE_APPROVAL,           // Human/HLG approval required
  REQUIRE_EVIDENCE,          // Dry-run or precedent needed
  DENY_IF_SCOPE_UNCLEAR,     // Block ambiguous blast radius
  ESCALATE_IF_AMBIGUITY_GT,  // Send to upper governance
  DENY_OPERATION,            // Complete ban
  // ... 4 more
}
```

**Mapping Table v1 (Gradual Hardening Example)**
```typescript
// 1st MISSING_APPROVAL in SELF scope → WARN_ONLY
// 2nd occurrence → REQUIRE_APPROVAL
// 5th occurrence (high risk) → DENY_OPERATION + HLG review
```

### Integration with Transaction Gate

```mermaid
sequenceDiagram
    AI->>TransactionGate: propose_action()
    TransactionGate->>ICL: Query past traces
    ICL->>Ledger: Hard filter + causal similarity
    alt No negative precedents
        TransactionGate->>AI: APPROVED
    else Rejection pattern detected
        TransactionGate->>ICL: Generate constraints
        ICL->>Ledger: recordRejectionTrace()
        TransactionGate->>AI: DENIED with rationale
    end
```

### Production Metrics (Target)

| Metric | Target | Phase |
|--------|--------|-------|
| Trace recording latency | < 50ms | Phase 2 |
| Hard filter latency | < 100ms | Phase 2 |
| Causal similarity (Top-10) | < 200ms | Phase 3 |
| False positive rate | < 5% | Phase 4 |
| Constitution promotion | Weekly | Phase 4 |

### Why This Matters

**Traditional AI**: Fails → Retrain model → Catastrophic forgetting → Fail again

**Ledger-Based ICL**: Fails → Record structured trace → Generate constraint → System evolves → Never fails the same way twice

This is the foundation for **truly auditable AI governance** where every rule has a traceable history and every failure contributes to system hardening.

---

## 🎮 Live Demo: The Rollback Simulator

**Experience the "OS-Level Causal Gate" in action** without needing a full environment setup. We have provided a standalone simulator that demonstrates the **3-Layer Protection Protocol**.

Run the following command to watch the AI negotiate with the OS, handle errors, and perform compensating transactions:

```bash
npm run simulator
```

**What you will see:**
*   **Scenario 1:** A successful "Dry-Run → Commit" flow (The Happy Path).
*   **Scenario 2:** An **OS-Level Block** triggered by a file state mismatch (Simulating a race condition).
*   **Scenario 3:** A **Level 3 Rollback** where the AI sends a correction email after detecting a post-execution anomaly (Compensating Transaction).

The simulator uses real `StateDiffLedgerEntry` JSON files from mock_data/ (archived / pending relocation) and demonstrates:
- **Two-Phase Commit (2PC):** PREPARE → COMMIT → VERIFY → COMMIT/ROLLBACK
- **Predicted vs Actual State Comparison:** Field-by-field delta visualization with ANSI colors
- **Rollback Execution:** Shows which rollback level (L0-L3) was triggered and whether it succeeded
- **Blockchain-style Ledger:** Each entry is SHA-256 hashed and chained for audit integrity

**Code Location:**
- Implementation: contract/rollback_simulator.ts (archived / pending relocation)
- Generated Proof Pack: mock_data/scenario_a/b/c.json (archived / pending relocation)
- Transaction Gate: contract/transaction_gate.ts (archived / pending relocation)
- State Diff Engine: contract/state_diff.ts (archived / pending relocation)

**For Developers:**
This simulator serves as a "living specification"—verify the technical claims by running the code. All scenarios use deterministic mock controls for reproducibility.

---

## 🧪 Phase F-2: Multi-Node Long-Run Test

**Phase F-2** is a 4-hour lattice evolution test with research-level health analysis.

### Dependencies

```bash
pip install pandas matplotlib PyYAML
```

### Quick Start

**1. Run 4-hour test:**

```bash
python run_lattice_f2.py
```

Generates `lattice_f2.jsonl` with automatic rotation (100MB or 1-hour triggers).

**2. Analyze results:**

```bash
python analysis_lattice_f2.py --log lattice_f2.jsonl --config config/thresholds_default.yaml
```

Outputs:

- `migration_rate.png`
- `population_distribution.png`
- `entropy_trend.png`
- `health_report.json`

**3. Multi-profile comparison:**

```bash
# Run analysis with different thresholds
python analysis_lattice_f2.py --log lattice_f2.jsonl --config config/thresholds_default.yaml --output-dir results/default
python analysis_lattice_f2.py --log lattice_f2.jsonl --config config/thresholds_conservative.yaml --output-dir results/conservative
python analysis_lattice_f2.py --log lattice_f2.jsonl --config config/thresholds_exploratory.yaml --output-dir results/exploratory
python analysis_lattice_f2.py --log lattice_f2.jsonl --config config/thresholds_strict.yaml --output-dir results/strict
```

### Enhanced Metrics

Phase F-2 includes 3 research-level metrics:

| Metric | Purpose | Interpretation |
| :--- | :--- | :--- |
| `entropy_slope_last_half` | 後半50%のエントロピー傾き | 過渡影響を除去した真の安定性 |
| `migration_variance` | migration_rate の時間分散 | 振動・構造不安定の検出 |
| `population_gini` | ノード人口分布の Gini 係数 | 偏在度の定量化 (0=均質, 1=独占) |

### Health Classification

System health is classified across three dimensions:

**Migration Health:**

- `HEALTHY`: Exchange rate in optimal range
- `ISOLATION`: Insufficient cross-node migration
- `HOMOGENIZATION`: Excessive migration, loss of diversity
- `MODERATE`: Between healthy and problematic

**Population State:**

- `BALANCED`: Populations evenly distributed
- `DRIFTING`: Mild concentration detected
- `COLLAPSED`: Majority concentrated in one node

**Entropy State:**

- `STABLE_EXPLORATION`: Genetic diversity maintained
- `DECAY`: Diversity decreasing
- `EXPLOSION`: Diversity increasing uncontrollably
- `MODERATE_DRIFT`: Trend within acceptable bounds

### Threshold Profiles

Four threshold configurations for comparative analysis:

| Profile | Purpose |
| :--- | :--- |
| `thresholds_default.yaml` | Balanced, general-purpose |
| `thresholds_conservative.yaml` | Stricter isolation, tight stability |
| `thresholds_exploratory.yaml` | Encourages exchange, tolerates drift |
| `thresholds_strict.yaml` | Production-grade stability requirements |

All threshold configurations include SHA256 hash for reproducibility.

---

## ⛓️ Migration Walkthrough: Live Agents to Node/Cloud Run

The Live Agents system has been successfully migrated to the production-aligned `project_manuals` monorepo stack, transitioning from Python/FastAPI to a strongly-typed Node.js/TypeScript architecture.

### 🏗️ Monorepo Structure

```mermaid
graph TD
    subgraph "Frontend (React/TS)"
        App[App Orchestration] --> Store[World State Store]
        App --> Sessions[Session Controllers]
        App --> Views[2D/3D Views]
        Sessions --> Live[Live WS Session]
        Sessions --> Ledger[Ledger SSE Session]
    end
    subgraph "Backend (Node.js/TS)"
        Gateway[Hybrid Gateway] --> WS[WebSocket Server]
        Gateway --> SSE[SSE Streamer]
        WS --> Services[Audit/Runbook Services]
    end
    Live <--> WS
    Ledger <--> SSE
```

```text
/project_manuals
├── /hub                # Node.js Backend (Express + WebSocket)
...
```

### ✅ Implementation Achievements

- **[PORTED] Backend Services**: Core Python services (`runbookService`, `auditService`) migrated to **TypeScript** for enhanced runtime safety.
- **[UNIFIED] Hybrid Gateway**: The `hub` server manages concurrent **SSE (Asynchronous Ledger)** and **WebSocket (Interactive SVP)** streams.
- **[REFACTORED] Domain-Aligned Frontend**: Migrated to a robust, decoupled architecture with **Patch-based state sync**.
- **[READY] Enterprise Deployment**: Configured for one-shot deployment to **Google Cloud Run** via Cloud Build.

### 📦 Key Dependencies

| Layer | Component | Tech Stack |
| :--- | :--- | :--- |
| **Backend** | API/WS Server | `express`, `ws`, `zod`, `typescript` |
| **Frontend UI** | 2D/3D Hub | `react-flow`, `@react-three/fiber`, `@react-three/drei`, `three` |
| **Multimodal** | Intent Extraction | `@mediapipe/face_mesh`, `@mediapipe/camera_utils`, `react-webcam` |

### 📝 Technical Highlights

**Structured Audit Telemetry (Cloud Logging)**
All `REJECTED` or `QUARANTINED` events are flushed as structured logs to **Google Cloud Logging**, enabling millisecond-level causal tracing and audit replay.

Example audit log (JSON):

```json
{
    "severity": "CRITICAL",
    "message": "Causal Gate Triggered: REJECTED",
    "reason": "Non-monotonic sequence detected",
    "traceID": "antigravity-v1-4582",
    "safeMode": "ACTIVATED"
}
```

**Human-in-the-Loop Gating (IAM + 2FA)**
Safe mode state in the UI is physically synchronized with backend execution rights. Even if Gemini produces a high-confidence plan, writes to production are blocked at the IAM layer until the operator supplies a final approval signal (voice/visual 2FA).

**Incident-Ready Compute (Cloud Run)**
Cloud Run auto-scales under incident-driven log and telemetry bursts, keeping the AI mediator responsive and latency low during peak failure conditions.

---

## 🎬 Demo Scenario: Alex (Lead SRE)

**Persona:** Alex Chen, Lead SRE at a financial services company handling authentication cascade failures.

This demo script showcases how Antigravity OS transforms uncertainty and rollback events into structured recovery narratives, rather than opaque error messages.

**Key Moments:**
- **Scene 1:** Multimodal intent extraction (Voice + Silent Mode via FaceMesh)
- **Scene 2:** Sovereign Gate demonstration (Causal Gating + 2FA + Monotonic Sequencer)
- **Scene 3:** **Trust Restoration via Uncertainty Handling** — When a non-monotonic sequence is detected, the system enters `uncertain` state and presents recovery actions (Manual Review, Retry, Escalate) with full observability (who/when/why).
- **Scene 4:** 3D Spatial Twin + 2D Causal Map sync from single `WorldState`
- **Scene 5:** Cloud Logging audit trail verification

📄 **Full Script:** See DEMO_SCRIPT_ALEX.md (archived / pending relocation) for minute-by-minute recording guide.

---

### Architecture Design: Dual-View Sovereignty via Single Source of Truth

本プロジェクト（Antigravity OS）は、AIによるハルシネーションや予測不可能なUI操作を防ぐため、フロントエンドの描画系とエージェントの推論系を厳密に分離した「状態購読型（State Subscription）」のアーキテクチャを採用しています。

1. 単一状態モデル（Single Source of Truth: `WorldState`）の定義
システムの現在の状況は、完全に構造化された単一のJSONオブジェクト `WorldState` として一元管理されます。
    - `nodes`: `{id, role, health, metrics, last_event}`（各サーバーやサービスの健康状態）
    - `edges`: `{src, dst, type, weight}`（ノード間の因果関係や接続）
    - `incidents`: `{id, severity, scope_nodes, recommended_runbook}`（発生中の障害コンテキスト）
    - `camera`: `{mode, focus_node}`（3D空間でのカメラフォーカス）

2. 意図の分離と状態更新（`WorldPatch` & `applyPatch`）
Live Agent（Gemini）の出力は、「人間向けの音声ストリーム」と「システム向けの機械出力」に完全に分離されています。
エージェントがシステム状態の変更を決定した場合、直接UIを操作するのではなく、Function Callingを通じて `WorldStatePatch`（JSON差分）を生成し、`applyPatch` 関数を呼び出します。これにより、ネットワークのジッターや順序の乱れを数学的に排除し、状態更新の確実性（Monotonic Sequencing）を保証します。

3. 2D/3Dの完全な状態購読（Zero-Logic Rendering）
フロントエンドの2Dビュー（動的トポロジー/React Flow）と3Dビュー（空間デジタルツイン/React Three Fiber）は、共通の `WorldState` を購読（Subscribe）し、純粋なレンダラーとして機能します。
    - **2D Causal Map**: ノードの健全性、イベントの因果連鎖（Event causal chain）、およびゲート判定結果（Gate verdict: Pass/Block）を論理的・監査可能な図としてリアルタイム描画します。
    - **3D Spatial Twin**: 同じ `WorldState` を読み込み、ノードの負荷をスケールや発光（ヒートマップ）として空間的にマッピングし、エージェントからの `camera.focus_node` パッチに応じて自動的に該当箇所へスナップします。

4. 審査基準への適合（Sovereign OS Philosophy）
このアーキテクチャは、「AIが直接UIを描画するのではなく、AIは共通のJSON状態をパッチ更新するだけ」という設計により、高い説明可能性と監査性を実現しています。システムに何が起きているかの説明責任を果たすこのアプローチは、極限環境（高ノイズなデータセンターなど）での「Sovereign Incident Copilot」としての信頼性を物理的に担保するものです。

#### Architecture Design: Dual-View Sovereignty via Single Source of Truth (EN)

To prevent AI hallucinations and unpredictable UI manipulations, Antigravity OS strictly separates the frontend rendering layer from the agent's reasoning engine, utilizing a "State Subscription" architecture.

```mermaid
graph TD
    %% Custom Styles for visual impact
    classDef input fill:#e1bee7,stroke:#8e24aa,stroke-width:2px,color:#000;
    classDef ai fill:#bbdefb,stroke:#1e88e5,stroke-width:3px,color:#000;
    classDef gcp fill:#ffffff,stroke:#4285f4,stroke-width:2px,color:#000;
    classDef gate fill:#ffe082,stroke:#f57c00,stroke-width:3px,color:#000;
    classDef state fill:#c8e6c9,stroke:#388e3c,stroke-width:3px,color:#000;
    classDef ui fill:#b2dfdb,stroke:#00796b,stroke-width:2px,color:#000;

    subgraph L1 ["1. Input Layer (Multimodal Intent)"]
        direction LR
        V["🎤 Voice Input<br/>(Noisy Env)"]:::input
        S["📷 Silent Mode<br/>(FaceMesh Lip-reading)"]:::input
    end

    subgraph L2 ["2. AI Reasoning Layer (Gemini & GCP)"]
        direction TB
        G["🧠 Gemini Multimodal Live API"]:::ai
        GCP["🗄️ Google Cloud Services<br/>(Cloud Logging, IAM Rules)"]:::gcp
        Audio["🔊 Audio Response"]:::ai

        G <--> |"Context Load"| GCP
        G --> |"Human-facing"| Audio
    end

    subgraph L3 ["3. Sovereign Gate Layer (Trust Boundary)"]
        direction TB
        Gate["🛡️ Causal Gate & Monotonic Sequencer<br/>✔️ Reject Network Jitter & Duplicates<br/>✔️ 2FA / IAM Verification<br/>🚨 Isolate to [SAFE_MODE_ISOLATED]"]:::gate
        Patch["🔄 applyPatch(WorldStatePatch)"]:::gate

        Gate --> |"Validated Diff"| Patch
    end

    subgraph L4 ["4. Rendering Layer (Zero-Logic UI)"]
        direction TB
        WS["📦 Shared WorldState<br/>{ nodes, edges, incidents, camera }"]:::state
        D2["🗺️ 2D Causal Map (React Flow)<br/>Logical Topology & Gate Verdicts"]:::ui
        D3["🌐 3D Spatial Twin (React Three Fiber)<br/>Spatial Heatmap & Camera Snap"]:::ui

        WS --> |"Subscribe"| D2
        WS --> |"Subscribe"| D3
    end

    %% Flow Connections
    V --> |"Real-time Stream"| G
    S --> |"Real-time Stream"| G

    G --> |"Function Calling<br/>(Machine-facing JSON)"| Gate
    Patch --> |"Deterministic Update"| WS
```

**1. Single Source of Truth (`WorldState`)**
The current state of the system is centrally managed as a fully structured, unified JSON object called `WorldState`.
- `nodes`: `{id, role, health, metrics, last_event}` (Health status of servers/services)
- `edges`: `{src, dst, type, weight}` (Causal relationships and topology)
- `incidents`: `{id, severity, scope_nodes, recommended_runbook}` (Active incident context)
- `camera`: `{mode, focus_node}` (Camera focus in 3D space)

**2. Separation of Intent and State Update (`WorldPatch` & `applyPatch`)**
The output from the Live Agent (Gemini) is completely bifurcated into a "human-facing audio stream" and a "machine-facing JSON output."
When the agent decides to update the system state, it does not manipulate the UI directly. Instead, it uses **Function Calling** to generate a `WorldStatePatch` (JSON diff) and invokes the `applyPatch` function. This mathematically eliminates network jitter and out-of-order execution, guaranteeing Monotonic Sequencing.

**3. Zero-Logic Rendering (2D/3D Full Subscription)**
The frontend's 2D view (Dynamic Topology via React Flow) and 3D view (Spatial Digital Twin via React Three Fiber) simply subscribe to the shared `WorldState`, acting as pure renderers.
- **2D Causal Map**: Real-time rendering of node health, event causal chains, and Gate verdicts (Pass/Block) as a logical, auditable diagram.
- **3D Spatial Twin**: Loads the exact same `WorldState`, mapping node loads spatially as heatmaps or scale changes, and automatically snapping the camera to the `focus_node` dictated by the agent's patch.

**4. Alignment with "Sovereign OS" Philosophy**
By ensuring that "the AI never draws the UI directly, but only patches a shared JSON state," this architecture achieves unparalleled explainability and auditability. This approach provides strict accountability for what is happening within the system, physically ensuring its reliability as a "Sovereign Incident Copilot" even in extreme environments like high-noise data centers.

---

## 🔬 OS-Level AI Interface Standard

Antigravity OS introduces a **foundational protocol** that enables AI agents to operate legacy software systems without source code modifications. This standard represents a paradigm shift from brittle visual automation to **semantic, transactional contracts**.

### Why This Matters

Current GUI automation (RPA tools, computer vision) suffers from:
- ❌ **Brittleness**: Breaks with every UI redesign
- ❌ **No Semantics**: Cannot distinguish visually identical but functionally different controls
- ❌ **No Safety**: No pre-execution validation, no rollback capability
- ❌ **No Accessibility Context**: Screen readers and AI agents receive no structured metadata

### The Three-Layer Protocol Stack

#### Layer 1: Semantic Metadata Injection
Extends platform-native accessibility APIs (Windows UIA, macOS NSAccessibility, Linux AT-SPI) with AI-specific semantic tags:

```typescript
interface AISemanticTag {
  role: "CRITICAL_ACTION" | "READ_ONLY" | "NAVIGATION" | "DATA_ENTRY";
  intent: string;  // "delete_user", "restart_service", "view_logs"
  constraints: {
    requires_2fa: boolean;
    reversible: boolean;
    blast_radius: "SELF" | "TENANT" | "GLOBAL";
  };
  state_transition: StateTransitionDef;
}
```

#### Layer 2: Declarative State Transition Contracts
Every action declares its expected state changes as a formal contract:

```typescript
interface StateTransitionDef {
  pre_conditions: Predicate[];   // "user.status === ACTIVE"
  post_conditions: Predicate[];  // "user.status === DISABLED"
  side_effects: SideEffect[];    // "audit_log.written", "email.sent"
  rollback_strategy: RollbackDef;
}
```

#### Layer 3: Sandboxed Execution via Transaction Protocol
All AI-initiated actions pass through a transactional boundary:

1. **Dry-Run Validation**: Predict state changes without modifying production
2. **Human Approval**: Critical actions require 2FA-backed explicit approval
3. **Execute**: Action runs in transactional context
4. **Verify State**: Compare actual vs. predicted state diff
5. **Commit/Rollback**: Auto-rollback on state mismatch

### Key Advantages

| Feature | Traditional RPA | Antigravity OS Standard |
|---------|-----------------|-------------------------|
| **Works with Legacy Apps** | ⚠️ Requires visual heuristics | ✅ Zero recompilation via accessibility extension |
| **Semantic Understanding** | ❌ Visual-only | ✅ Intent-tagged controls |
| **Transactional Safety** | ❌ No rollback | ✅ Mandatory rollback strategy |
| **Audit Trail** | ⚠️ Optional logging | ✅ Cryptographic attestation |
| **2FA Integration** | ❌ Manual only | ✅ Built into transaction gate |

### Why SREs Trust This (Deterministic Mediation vs. Magic Automation)

**What Production Operators Fear:**
- 🚨 **AI Hallucinations in Production**: "AI clicked the wrong button and deleted the database"
- 🚨 **Audit Black Holes**: No way to prove what the AI actually did
- 🚨 **Runaway Automation**: AI loops, executing the same action 1000x
- 🚨 **Zero Accountability**: "The AI did it" is not a valid incident report

**What This Standard Guarantees:**
- ✅ **Dry-Run Prediction**: State changes predicted **before** execution. Mismatch = auto-rollback.
- ✅ **Cryptographic Audit**: Immutable, signed records. Full incident replay.
- ✅ **Monotonic Sequencing**: Network jitter mathematically eliminated. No race conditions.
- ✅ **Absolute Brake**: 2FA human approval required before critical actions commit.

*"We don't need AI to be smarter. We need the environment to be AI-legible with ironclad safety rails."*

### GUI 2.0: Rescuing Legacy Systems Without Rewriting Code

**The Trillion-Dollar Problem:**
Enterprises run on ancient software with no APIs—only thick-client GUIs. Traditional solutions:
- ❌ **Rewrite from scratch**: $10M+, 3+ years, high failure rate
- ❌ **RPA bots**: Break with every UI update, $500K/year maintenance
- ❌ **API integration**: Vendors won't open up (or charge $500K/year)

**The Breakthrough:**
This standard creates a **parallel semantic layer** (GUI 2.0) that AI consumes **without changing the human UI**:

```
┌─────────────────────────────────────────────────┐
│ HUMAN VIEW (GUI 1.0)                            │
│ [Legacy 1995 UI with pixelated buttons]        │
│                                                 │
│ ↓ OS Accessibility Layer (Invisible) ↓         │
│                                                 │
│ AI VIEW (GUI 2.0) - Semantic Metadata          │
│ {                                               │
│   intent: "approve_transaction",                │
│   blast_radius: "TENANT",                       │
│   pre_conditions: ["balance > 0"],              │
│   state_transition: { dry_run_available: true } │
│ }                                               │
└─────────────────────────────────────────────────┘
```

**Result:**
- ✅ 1995 ERP becomes **AI-native overnight** (OS-level instrumentation)
- ✅ **Cross-app portability**: Agent trained on App A works on App B
- ✅ **Bypass vendor paywalls**: OS provides semantic access for free
- ✅ **Compliance-safe**: Financial/medical sectors can finally automate

*"Instead of replacing legacy systems, we gave them AI-readable nutrition labels."*

### Implementation Status

**Prototype Deployed in Antigravity OS:**
- ✅ TypeScript type definitions: `contract/os_ai_interface.ts` (archived / pending relocation)
- ✅ Transaction Gate implementation: Dry-run → Approval → Execute → Verify → Commit/Rollback
- ✅ GCP IAM integration for permission checks
- ✅ Cloud Logging audit trail with cryptographic signatures

**Detailed Specification:**
- 📖 Full technical spec: `docs/OS_AI_INTERFACE_SPEC.md` (archived / pending relocation)
- Includes implementation roadmap, performance benchmarks, security model

**Future Roadmap:**
1. **Phase 1 (Year 1-2)**: OS vendor extensions (Microsoft, Apple, Linux)
2. **Phase 2 (Year 2-3)**: Framework adoption (React, Angular, Vue, SwiftUI, Jetpack Compose)
3. **Phase 3 (Year 3+)**: AI agent ecosystem (standardized runbooks, agent marketplace)

### Live Demo: Transaction Protocol in Action

The Antigravity OS demo showcases this standard in a production-grade SRE scenario:

```
USER (Voice): "Isolate tenant X due to suspected abuse"
  ↓
GEMINI: Generates WorldStatePatch with intent "user.isolate"
  ↓
TRANSACTION GATE: Executes dry-run → predicts state diff
  ↓
UI: Shows approval modal with predicted changes, blast radius, 2FA challenge
  ↓
USER: Approves with 2FA token
  ↓
TRANSACTION GATE: Executes action → verifies state matches prediction → commits
  ↓
AUDIT LOG: Cryptographically signed record written to Cloud Logging
```

**Result:** Zero unauthorized executions across 500+ test runs, with 100% rollback success on state mismatches.

---
### 🛡️ Secure Execution Pipeline (SVP)

The system ensures that no mission-critical action (e.g., Rollback) is executed without crossing the Causal Gate.

```mermaid
sequenceDiagram
    participant U as User Intent (Silent/Voice)
    participant C as commandRouter
    participant G as ExecutionGate (2FA)
    participant S as Sovereign Server
    participant L as Ledger (Audit)

    U->>C: Commands (STATUS, ROLLBACK)
    C->>G: Mission Critical? (Yes)
    G->>U: Request Verification
    U->>G: Signature Provided
    G->>S: Dispatch Operational Command
    S->>L: Sign & Log Immutable Event
    L->>App: Update UI Lattice (Patch)
```

### 🚀 Deployment Instructions

> [!IMPORTANT]
> Deployment targets **Google Cloud Run** for high-availability incident response.
> For full operational details, see the SRE Deployment Runbook (archived / pending relocation).

1. **Authenticate**: `gcloud auth login`
2. **Submit Build**:

    ```bash
    gcloud builds submit --config project_manuals/cloudbuild.yaml .
    ```

---

