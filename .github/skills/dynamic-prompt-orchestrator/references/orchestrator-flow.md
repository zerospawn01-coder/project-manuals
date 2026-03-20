# Orchestrator Flow

Six-step workflow:

1. Normalize the request
2. Apply hard filter
3. Compute causal similarity
4. Force-inject constraints based on risk
5. Compress context into prompt form
6. Enforce output type constraints

Key normalized structures:

- `IntentRecord`
- `ActionSignature`
- `GovernanceRequirements`
- `NormalizedRequest`

Normalization guidance:

- Lowercase and normalize the intent string.
- Infer operation type from verbs like create, read, update, delete, execute.
- Normalize action signatures such as HTTP method plus resource path.
- Infer blast radius, risk level, permissions, prerequisites, and capabilities.

Use hard filter before similarity to drop obviously incompatible precedents, including:

- capability mismatch
- scope incompatibility
- corrected traces that should not be reused
- traces older than the relevant window

Final output should usually contain:

- normalized request summary
- selected precedents or rules
- injected constraints
- compressed operator-facing prompt or decision context
