import Ajv, { ErrorObject } from 'ajv';

export type Mechanism = 'hard' | 'soft' | 'partial';
export type Status = 'implemented' | 'specified' | 'inferred';
export type EvidenceType = 'official_docs' | 'paper' | 'issue' | 'security_report' | 'analysis';
export type EvidenceScope = 'runtime' | 'extension' | 'inference';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type RiskAction = 'monitor' | 'review' | 'freeze';
export type GateDecision = 'ACCEPT' | 'REJECT' | 'REVIEW_REQUIRED';

export interface Evidence {
  type: EvidenceType;
  ref: string;
  confidence: number;
  scope: EvidenceScope;
  note: string;
  owner: string;
  last_verified: string;
}

export interface ComparisonCell {
  label: string;
  mechanism: Mechanism;
  status: Status;
  detail: string;
  evidences: Evidence[];
}

export interface ComparisonRow {
  axis: string;
  icon: string;
  openclaw: ComparisonCell;
  agos: ComparisonCell;
}

export interface ComparisonConflict {
  rowAxis: string;
  side: 'openclaw' | 'agos';
  type: 'source_mismatch' | 'scope_violation' | 'confidence_gap';
  severity: 'warn' | 'error';
  reason: string;
}

export interface CellDiff {
  side: 'openclaw' | 'agos';
  changes: string[];
}

export interface RowDiff {
  axis: string;
  cellDiffs: CellDiff[];
  impactScore: number;
  riskLevel: RiskLevel;
  action: RiskAction;
}

export interface ComparisonDiffAudit {
  addedAxes: string[];
  removedAxes: string[];
  changedRows: RowDiff[];
  totalImpactScore: number;
  highestRiskLevel: RiskLevel;
  highestRiskAction: RiskAction;
}

export interface ComparisonPolicy {
  schema_version: string;
  score_threshold: number;
  reject_on_error: boolean;
  review_required_on_warn: boolean;
  risk_actions: Record<RiskLevel, RiskAction>;
  freeze_on_risk_levels: RiskLevel[];
  requires_human_on_decisions: GateDecision[];
  freeze_command?: string;
}

export interface PolicyDecision {
  accepted: boolean;
  decision: GateDecision;
  conflicts: ComparisonConflict[];
  rejected: ComparisonConflict[];
  warnings: ComparisonConflict[];
}

export interface ComparisonGateResult {
  decision: GateDecision;
  policy: ComparisonPolicy;
  conflicts: ComparisonConflict[];
  accepted: boolean;
}

export const DEFAULT_POLICY: ComparisonPolicy = {
  schema_version: '0.1',
  score_threshold: 0.6,
  reject_on_error: true,
  review_required_on_warn: true,
  risk_actions: {
    low: 'monitor',
    medium: 'review',
    high: 'freeze',
    critical: 'freeze',
  },
  freeze_on_risk_levels: ['high', 'critical'],
  requires_human_on_decisions: ['REVIEW_REQUIRED', 'REJECT'],
};

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) {
    return 'unknown schema validation error';
  }

  return errors
    .map((err) => {
      const path = err.instancePath || '/';
      return `${path} ${err.message ?? 'is invalid'}`;
    })
    .join('; ');
}

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  const order: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
  return order[Math.max(order.indexOf(a), order.indexOf(b))];
}

function isGateDecision(value: unknown): value is GateDecision {
  return value === 'ACCEPT' || value === 'REJECT' || value === 'REVIEW_REQUIRED';
}

export function normalizePolicy(raw: unknown): ComparisonPolicy {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_POLICY;
  }

  const policy = raw as Partial<ComparisonPolicy>;
  return {
    schema_version: typeof policy.schema_version === 'string' ? policy.schema_version : DEFAULT_POLICY.schema_version,
    score_threshold:
      typeof policy.score_threshold === 'number' && policy.score_threshold >= 0 && policy.score_threshold <= 1
        ? policy.score_threshold
        : DEFAULT_POLICY.score_threshold,
    reject_on_error: typeof policy.reject_on_error === 'boolean' ? policy.reject_on_error : DEFAULT_POLICY.reject_on_error,
    review_required_on_warn:
      typeof policy.review_required_on_warn === 'boolean'
        ? policy.review_required_on_warn
        : DEFAULT_POLICY.review_required_on_warn,
    risk_actions:
      policy.risk_actions &&
      typeof policy.risk_actions.low === 'string' &&
      typeof policy.risk_actions.medium === 'string' &&
      typeof policy.risk_actions.high === 'string' &&
      typeof policy.risk_actions.critical === 'string'
        ? (policy.risk_actions as Record<RiskLevel, RiskAction>)
        : DEFAULT_POLICY.risk_actions,
    freeze_on_risk_levels:
      Array.isArray(policy.freeze_on_risk_levels) && policy.freeze_on_risk_levels.length > 0
        ? (policy.freeze_on_risk_levels as RiskLevel[])
        : DEFAULT_POLICY.freeze_on_risk_levels,
    requires_human_on_decisions:
      Array.isArray(policy.requires_human_on_decisions) && policy.requires_human_on_decisions.every(isGateDecision)
        ? (policy.requires_human_on_decisions as GateDecision[])
        : DEFAULT_POLICY.requires_human_on_decisions,
    freeze_command: typeof policy.freeze_command === 'string' && policy.freeze_command.length > 0 ? policy.freeze_command : undefined,
  };
}

export function validateComparisonRowsWithSchema(data: unknown, schema: unknown): ComparisonRow[] {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema as object);
  const valid = validate(data);

  if (!valid) {
    throw new Error(`comparison_data.json failed schema validation: ${formatAjvErrors(validate.errors)}`);
  }

  return data as ComparisonRow[];
}

export function scoreEvidence(evidence: Evidence): number {
  const typeWeight: Record<EvidenceType, number> = {
    official_docs: 1.0,
    security_report: 0.9,
    paper: 0.85,
    issue: 0.75,
    analysis: 0.65,
  };

  const scopeWeight: Record<EvidenceScope, number> = {
    runtime: 1.0,
    extension: 0.9,
    inference: 0.7,
  };

  const clampedConfidence = Math.max(0, Math.min(1, evidence.confidence));
  const raw = typeWeight[evidence.type] * scopeWeight[evidence.scope] * clampedConfidence;
  return Math.round(raw * 100) / 100;
}

export function scoreEvidences(evidences: Evidence[]): number {
  if (evidences.length === 0) {
    return 0;
  }

  const total = evidences.reduce((sum, evidence) => sum + scoreEvidence(evidence), 0);
  return Math.round((total / evidences.length) * 100) / 100;
}

export function detectComparisonConflicts(rows: ComparisonRow[], policy: ComparisonPolicy = DEFAULT_POLICY): ComparisonConflict[] {
  const conflicts: ComparisonConflict[] = [];

  for (const row of rows) {
    for (const side of ['openclaw', 'agos'] as const) {
      const cell = row[side];
      const aggregatedScore = scoreEvidences(cell.evidences);
      const hasAnalysisOnly = cell.evidences.every((evidence) => evidence.type === 'analysis');
      const hasInferenceEvidence = cell.evidences.some((evidence) => evidence.scope === 'inference');
      const hasRuntimeEvidence = cell.evidences.some((evidence) => evidence.scope === 'runtime');

      if (cell.status === 'implemented' && hasAnalysisOnly) {
        conflicts.push({
          rowAxis: row.axis,
          side,
          type: 'source_mismatch',
          severity: 'error',
          reason: 'implemented claim cannot rely on analysis-only evidences',
        });
      }

      if (cell.status === 'implemented' && hasInferenceEvidence) {
        conflicts.push({
          rowAxis: row.axis,
          side,
          type: 'scope_violation',
          severity: 'error',
          reason: 'implemented claim cannot use inference-only scope',
        });
      }

      if (cell.status === 'inferred' && !hasInferenceEvidence) {
        conflicts.push({
          rowAxis: row.axis,
          side,
          type: 'scope_violation',
          severity: 'error',
          reason: 'inferred claim must include at least one inference-scope evidence',
        });
      }

      if (cell.status === 'specified' && hasRuntimeEvidence) {
        conflicts.push({
          rowAxis: row.axis,
          side,
          type: 'scope_violation',
          severity: 'warn',
          reason: 'specified claim should avoid runtime-scope evidence',
        });
      }

      if (aggregatedScore < policy.score_threshold) {
        conflicts.push({
          rowAxis: row.axis,
          side,
          type: 'confidence_gap',
          severity: cell.status === 'implemented' ? 'error' : 'warn',
          reason: `aggregated evidence score ${aggregatedScore.toFixed(2)} is below threshold ${policy.score_threshold.toFixed(2)}`,
        });
      }
    }
  }

  return conflicts;
}

export function enforceComparisonPolicy(rows: ComparisonRow[], policy: ComparisonPolicy = DEFAULT_POLICY): PolicyDecision {
  const conflicts = detectComparisonConflicts(rows, policy);
  const rejected = conflicts.filter((conflict) => conflict.severity === 'error');
  const warnings = conflicts.filter((conflict) => conflict.severity === 'warn');

  let decision: GateDecision = 'ACCEPT';
  if (policy.reject_on_error && rejected.length > 0) {
    decision = 'REJECT';
  } else if (policy.review_required_on_warn && warnings.length > 0) {
    decision = 'REVIEW_REQUIRED';
  }

  return {
    accepted: decision !== 'REJECT',
    decision,
    conflicts,
    rejected,
    warnings,
  };
}

export function evaluateComparisonGate(rows: ComparisonRow[], policy: ComparisonPolicy = DEFAULT_POLICY): ComparisonGateResult {
  const outcome = enforceComparisonPolicy(rows, policy);
  return {
    decision: outcome.decision,
    policy,
    conflicts: outcome.conflicts,
    accepted: outcome.accepted,
  };
}

function calculateImpact(changes: string[]): number {
  const weights: Record<string, number> = {
    label: 0.05,
    mechanism: 0.2,
    status: 0.2,
    detail: 0.1,
    evidences: 0.25,
    'evidences.type': 0.15,
    'evidences.ref': 0.05,
    'evidences.confidence': 0.15,
    'evidences.scope': 0.15,
    'evidences.note': 0.05,
    'evidences.owner': 0.15,
    'evidences.last_verified': 0.1,
  };

  const sum = changes.reduce((total, change) => total + (weights[change] ?? 0.08), 0);
  return Math.min(1, Math.round(sum * 100) / 100);
}

function riskFromImpact(score: number): RiskLevel {
  if (score >= 0.75) {
    return 'critical';
  }
  if (score >= 0.5) {
    return 'high';
  }
  if (score >= 0.25) {
    return 'medium';
  }
  return 'low';
}

function buildCellDiff(previous: ComparisonCell, next: ComparisonCell): string[] {
  const changes: string[] = [];

  if (previous.label !== next.label) {
    changes.push('label');
  }
  if (previous.mechanism !== next.mechanism) {
    changes.push('mechanism');
  }
  if (previous.status !== next.status) {
    changes.push('status');
  }
  if (previous.detail !== next.detail) {
    changes.push('detail');
  }
  if (previous.evidences.length !== next.evidences.length) {
    changes.push('evidences');
  }

  const maxLength = Math.max(previous.evidences.length, next.evidences.length);
  for (let i = 0; i < maxLength; i += 1) {
    const prevEvidence = previous.evidences[i];
    const nextEvidence = next.evidences[i];

    if (!prevEvidence || !nextEvidence) {
      continue;
    }

    if (prevEvidence.type !== nextEvidence.type) {
      changes.push('evidences.type');
    }
    if (prevEvidence.ref !== nextEvidence.ref) {
      changes.push('evidences.ref');
    }
    if (prevEvidence.confidence !== nextEvidence.confidence) {
      changes.push('evidences.confidence');
    }
    if (prevEvidence.scope !== nextEvidence.scope) {
      changes.push('evidences.scope');
    }
    if (prevEvidence.note !== nextEvidence.note) {
      changes.push('evidences.note');
    }
    if (prevEvidence.owner !== nextEvidence.owner) {
      changes.push('evidences.owner');
    }
    if (prevEvidence.last_verified !== nextEvidence.last_verified) {
      changes.push('evidences.last_verified');
    }
  }

  return Array.from(new Set(changes));
}

export function auditComparisonDiff(
  previousRows: ComparisonRow[],
  nextRows: ComparisonRow[],
  policy: ComparisonPolicy = DEFAULT_POLICY
): ComparisonDiffAudit {
  const previousMap = new Map(previousRows.map((row) => [row.axis, row]));
  const nextMap = new Map(nextRows.map((row) => [row.axis, row]));

  const addedAxes = nextRows.filter((row) => !previousMap.has(row.axis)).map((row) => row.axis);
  const removedAxes = previousRows.filter((row) => !nextMap.has(row.axis)).map((row) => row.axis);

  const changedRows: RowDiff[] = [];

  for (const nextRow of nextRows) {
    const prevRow = previousMap.get(nextRow.axis);
    if (!prevRow) {
      continue;
    }

    const openclawChanges = buildCellDiff(prevRow.openclaw, nextRow.openclaw);
    const agosChanges = buildCellDiff(prevRow.agos, nextRow.agos);
    const cellDiffs: CellDiff[] = [];

    if (openclawChanges.length > 0) {
      cellDiffs.push({ side: 'openclaw', changes: openclawChanges });
    }
    if (agosChanges.length > 0) {
      cellDiffs.push({ side: 'agos', changes: agosChanges });
    }

    if (cellDiffs.length > 0) {
      const impactScore = Math.max(...cellDiffs.map((cellDiff) => calculateImpact(cellDiff.changes)));
      const riskLevel = riskFromImpact(impactScore);
      changedRows.push({
        axis: nextRow.axis,
        cellDiffs,
        impactScore,
        riskLevel,
        action: policy.risk_actions[riskLevel],
      });
    }
  }

  const totalImpactScore = Math.round(changedRows.reduce((sum, row) => sum + row.impactScore, 0) * 100) / 100;
  const highestRiskLevel = changedRows.reduce<RiskLevel>((current, row) => maxRisk(current, row.riskLevel), 'low');

  return {
    addedAxes,
    removedAxes,
    changedRows,
    totalImpactScore,
    highestRiskLevel,
    highestRiskAction: policy.risk_actions[highestRiskLevel],
  };
}



export type DiffAudit = ComparisonDiffAudit;
export type ConflictItem = ComparisonConflict;
export type CellData = ComparisonCell & { score: number; hasConflict: boolean };
export type ComparisonViewRow = {
  axis: string;
  icon: string;
  openclaw: CellData;
  agos: CellData;
};
export type LoadComparisonResult = {
  rows: ComparisonViewRow[];
  conflicts: ConflictItem[];
  diff: DiffAudit;
};

/**
 * loaderの返り値をApp完全整合の型で返す
 */
export async function loadComparison(): Promise<LoadComparisonResult> {
  const appBase = '/renderer-react/src/app/';
  const schemaUrl = `${appBase}comparison_schema.json`;
  const dataUrl = `${appBase}comparison_data.json`;
  const policyUrl = `${appBase}policy.json`;

  const [schemaResponse, dataResponse, policyResponse] = await Promise.all([
    fetch(schemaUrl),
    fetch(dataUrl),
    fetch(policyUrl),
  ]);

  if (!schemaResponse.ok) {
    throw new Error(`Failed to load comparison schema: HTTP ${schemaResponse.status}`);
  }
  if (!dataResponse.ok) {
    throw new Error(`Failed to load comparison data: HTTP ${dataResponse.status}`);
  }
  if (!policyResponse.ok) {
    throw new Error(`Failed to load policy: HTTP ${policyResponse.status}`);
  }

  const schema = (await schemaResponse.json()) as unknown;
  const data = (await dataResponse.json()) as unknown;
  const rawPolicy = (await policyResponse.json()) as unknown;
  const policy = normalizePolicy(rawPolicy);

  const rowsRaw = validateComparisonRowsWithSchema(data, schema);
  const conflicts = detectComparisonConflicts(rowsRaw, policy);

  function cellHasConflict(axis: string, side: 'openclaw' | 'agos'): boolean {
    return conflicts.some((c) => c.rowAxis === axis && c.side === side);
  }
  function cellScore(cell: ComparisonCell): number {
    return scoreEvidences(cell.evidences);
  }
  const rows: ComparisonViewRow[] = rowsRaw.map((row) => ({
    axis: row.axis,
    icon: row.icon,
    openclaw: {
      ...row.openclaw,
      score: cellScore(row.openclaw),
      hasConflict: cellHasConflict(row.axis, 'openclaw'),
    },
    agos: {
      ...row.agos,
      score: cellScore(row.agos),
      hasConflict: cellHasConflict(row.axis, 'agos'),
    },
  }));
  const diff = auditComparisonDiff(rowsRaw, rowsRaw, policy); // TODO: 比較元があれば差分監査
  return {
    rows,
    conflicts,
    diff,
  };
}
