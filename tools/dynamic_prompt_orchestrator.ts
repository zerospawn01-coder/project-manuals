/**
 * tools/dynamic_prompt_orchestrator.ts
 * 
 * Dynamic Prompt Orchestrator
 * 実行時の動的プロンプト編成エンジン
 * 
 * ICLは「長文を読ませて賢くする」ためではなく、
 * 「今この瞬間の意思決定に必要な最小十分集合の判例・規則を取り出し、
 * 審理可能な形に編成する」ためのもの。
 * 
 * 6ステップのワークフロー:
 * 1. 正規化
 * 2. 足切り（Hard Filter）
 * 3. 因果的類似度の計算
 * 4. リスクに応じた強制注入
 * 5. 文脈圧縮（プロンプト構築）
 * 6. 出力の型制約
 */

import {
  RejectionTrace,
  HardFilterCriteria,
  CausalSimilarityScore,
  ConstraintCapsule,
  ICLInjectionContext,
  ICLOutputType,
  ConstitutionRule,
  applyHardFilter,
} from '../contract/ledger_icl';
import { BlastRadius } from '../contract/os_ai_interface';
import { randomUUID } from 'crypto';
import fs from 'node:fs';
import path from 'node:path';
import { validateWorkflowEvent } from './workflow_runtime/eventSchemaRuntimeValidator';

export interface DispatchRecordEvent {
  event_id: string;
  event_type: 'dispatch_recorded';
  timestamp: string;
  trace_id: string;
  correlation_id: string;
  run_id: string;
  workflow_id: 'dynamic_prompt_orchestrator';
  stage_id: 'dispatch';
  week_id: string;
  state: 'PASS';
  severity: 'info';
  actor: {
    role: 'system';
    id: string;
  };
  evidence: Record<string, unknown>;
  payload: Record<string, unknown>;
  idempotency_key: string;
}

export interface DispatchValidationEvidence {
  schema_validated: boolean;
  schema_errors: string[];
  audit_log_path: string;
}

interface DispatchAuditLine {
  timestamp: string;
  validator: 'event_schema.v0.1.json';
  workflow_id: 'dynamic_prompt_orchestrator';
  stage_id: 'dispatch';
  event_id: string;
  week_id?: string;
  run_id?: string;
  schema_validated: boolean;
  schema_errors: string[];
  failure_reason?: string;
}

interface DispatchContextFields {
  week_id: string;
  trace_id: string;
  correlation_id: string;
  run_id: string;
}

export class ValidatedDispatchRecord {
  private readonly brand = 'ValidatedDispatchRecord';

  private constructor(
    public readonly event: DispatchRecordEvent,
    public readonly validation: DispatchValidationEvidence
  ) {}

  static fromValidated(
    event: DispatchRecordEvent,
    validation: DispatchValidationEvidence
  ): ValidatedDispatchRecord {
    return new ValidatedDispatchRecord(event, validation);
  }

  toJSON() {
    return {
      event: this.event,
      validation: this.validation,
    };
  }
}

// ============================================================================
// Step 1: 正規化
// ============================================================================

/**
 * Intent Record（意図）
 * 現在の案件の意図を表す正規化された構造
 */
export interface IntentRecord {
  /** 正規化された意図（例: delete_user） */
  intent_normalized: string;

  /** 元の生の意図文字列 */
  raw_intent: string;

  /** 信頼度（0.0 - 1.0） */
  confidence: number;

  /** 抽出されたエンティティ */
  entities: Record<string, any>;
}

/**
 * Action Signature（操作シグネチャ）
 * 操作の型を表す正規化された構造
 */
export interface ActionSignature {
  /** 正規化された操作シグネチャ（例: DELETE /api/users/:id） */
  signature_normalized: string;

  /** HTTPメソッド（該当する場合） */
  method?: string;

  /** リソースパス */
  resource_path?: string;

  /** 操作の種類（CREATE, READ, UPDATE, DELETE, EXECUTE） */
  operation_type: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE' | 'EXECUTE' | 'UNKNOWN';
}

/**
 * Governance Requirements（ガバナンス要件）
 * ガバナンス上の制約を表す構造
 */
export interface GovernanceRequirements {
  /** 影響範囲 */
  blast_radius: BlastRadius;

  /** リスクレベル */
  risk_level: 'low' | 'medium' | 'high' | 'critical';

  /** 必要な権限 */
  required_permissions: string[];

  /** 前提条件 */
  prerequisites: string[];

  /** 実行能力（capability） */
  capabilities: string[];
}

/**
 * 正規化された現在の案件
 */
export interface NormalizedRequest {
  request_id: string;
  intent: IntentRecord;
  action: ActionSignature;
  governance: GovernanceRequirements;
  timestamp: string;
}

/**
 * 生のリクエストを正規化
 */
export function normalizeRequest(raw_request: {
  intent: string;
  params: Record<string, any>;
  context: any;
}): NormalizedRequest {
  // 意図の正規化
  const intent: IntentRecord = {
    intent_normalized: normalizeIntent(raw_request.intent),
    raw_intent: raw_request.intent,
    confidence: 0.9, // TODO: 実際にはNLPモデルから取得
    entities: extractEntities(raw_request.params),
  };

  // 操作シグネチャの正規化
  const action: ActionSignature = {
    signature_normalized: inferActionSignature(raw_request),
    method: raw_request.params.method,
    resource_path: raw_request.params.resource,
    operation_type: inferOperationType(raw_request.intent),
  };

  // ガバナンス要件の推定
  const governance: GovernanceRequirements = {
    blast_radius: inferBlastRadius(raw_request),
    risk_level: inferRiskLevel(raw_request),
    required_permissions: inferRequiredPermissions(raw_request),
    prerequisites: [],
    capabilities: inferCapabilities(raw_request),
  };

  return {
    request_id: randomUUID(),
    intent,
    action,
    governance,
    timestamp: new Date().toISOString(),
  };
}

// ヘルパー関数

function normalizeIntent(raw_intent: string): string {
  let normalized = raw_intent.toLowerCase().trim();

  const synonyms: Record<string, string> = {
    'remove': 'delete',
    'erase': 'delete',
    'create': 'create',
    'add': 'create',
    'update': 'update',
    'modify': 'update',
    'change': 'update',
    'read': 'read',
    'get': 'read',
    'fetch': 'read',
  };

  for (const [from, to] of Object.entries(synonyms)) {
    normalized = normalized.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
  }

  normalized = normalized.replace(/\s+/g, '_');
  normalized = normalized.replace(/[^a-z0-9_]/g, '');

  return normalized;
}

function extractEntities(params: Record<string, any>): Record<string, any> {
  const entities: Record<string, any> = {};

  // UUIDパターン
  const uuid_pattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && uuid_pattern.test(value)) {
      entities[key] = ':uuid';
    } else if (typeof value === 'number') {
      entities[key] = ':number';
    } else {
      entities[key] = value;
    }
  }

  return entities;
}

function inferActionSignature(raw_request: any): string {
  const method = raw_request.params.method || 'UNKNOWN';
  const resource = raw_request.params.resource || '/unknown';

  // UUIDや数値IDをプレースホルダーに置換
  let normalized_resource = resource;
  normalized_resource = normalized_resource.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    ':uuid'
  );
  normalized_resource = normalized_resource.replace(/\/\d+/g, '/:id');

  return `${method} ${normalized_resource}`;
}

function inferOperationType(intent: string): ActionSignature['operation_type'] {
  const lower = intent.toLowerCase();
  if (lower.includes('delete') || lower.includes('remove')) return 'DELETE';
  if (lower.includes('create') || lower.includes('add')) return 'CREATE';
  if (lower.includes('update') || lower.includes('modify')) return 'UPDATE';
  if (lower.includes('read') || lower.includes('get')) return 'READ';
  if (lower.includes('execute') || lower.includes('run')) return 'EXECUTE';
  return 'UNKNOWN';
}

function inferBlastRadius(raw_request: any): BlastRadius {
  const resource = (raw_request.params.resource || '').toLowerCase();

  if (resource.includes('global') || resource.includes('system')) {
    return 'GLOBAL';
  }
  if (resource.includes('tenant') || resource.includes('org')) {
    return 'TENANT';
  }
  return 'SELF';
}

function inferRiskLevel(raw_request: any): 'low' | 'medium' | 'high' | 'critical' {
  const intent = raw_request.intent.toLowerCase();
  const blast_radius = inferBlastRadius(raw_request);

  if (intent.includes('delete') || intent.includes('remove')) {
    if (blast_radius === 'GLOBAL') return 'critical';
    if (blast_radius === 'TENANT') return 'high';
    return 'medium';
  }

  if (intent.includes('update') || intent.includes('modify')) {
    if (blast_radius === 'GLOBAL') return 'high';
    if (blast_radius === 'TENANT') return 'medium';
    return 'low';
  }

  return 'low';
}

function inferRequiredPermissions(raw_request: any): string[] {
  const permissions: string[] = [];
  const operation_type = inferOperationType(raw_request.intent);
  const blast_radius = inferBlastRadius(raw_request);

  permissions.push(`${operation_type.toLowerCase()}_${blast_radius.toLowerCase()}`);

  return permissions;
}

function inferCapabilities(raw_request: any): string[] {
  const capabilities: string[] = [];
  const operation_type = inferOperationType(raw_request.intent);

  capabilities.push(operation_type.toLowerCase());

  return capabilities;
}

// ============================================================================
// Step 3: 因果的類似度の計算
// ============================================================================

/**
 * 因果的類似度を計算
 * 意味的類似度だけでなく、因果構造の類似性を評価
 */
export function calculateCausalSimilarity(
  current: NormalizedRequest,
  past: RejectionTrace,
  weights: {
    intent: number;
    operation: number;
    constraint: number;
    risk: number;
    outcome: number;
  } = {
    intent: 0.3,
    operation: 0.25,
    constraint: 0.2,
    risk: 0.15,
    outcome: 0.1,
  }
): CausalSimilarityScore {
  // 1. 意図の類似度（Levenshtein距離）
  const intent_similarity = computeStringSimilarity(
    current.intent.intent_normalized,
    past.intent_normalized
  );

  // 2. 操作の類似度
  const operation_similarity = computeStringSimilarity(
    current.action.signature_normalized,
    past.operation_signature
  );

  // 3. 制約の類似度（BlastRadiusの一致度）
  const constraint_similarity =
    current.governance.blast_radius === past.blast_radius ? 1.0 : 0.0;

  // 4. リスクの類似度
  const risk_levels = ['low', 'medium', 'high', 'critical'];
  const current_risk_idx = risk_levels.indexOf(current.governance.risk_level);
  const past_risk_idx = risk_levels.indexOf(past.risk_level);
  const risk_similarity =
    1.0 - Math.abs(current_risk_idx - past_risk_idx) / risk_levels.length;

  // 5. 結果の類似度（同じRejectionClassか）
  // 初回なので0.5（中立）
  const outcome_similarity = 0.5;

  // 重み付けスコア
  const total_score =
    weights.intent * intent_similarity +
    weights.operation * operation_similarity +
    weights.constraint * constraint_similarity +
    weights.risk * risk_similarity +
    weights.outcome * outcome_similarity;

  return {
    total_score,
    breakdown: {
      intent_similarity,
      operation_similarity,
      constraint_similarity,
      risk_similarity,
      outcome_similarity,
    },
    weights,
  };
}

// 文字列類似度（Levenshtein距離）
function computeStringSimilarity(a: string, b: string): number {
  const max_len = Math.max(a.length, b.length);
  if (max_len === 0) return 1.0;
  const distance = levenshteinDistance(a, b);
  return 1.0 - distance / max_len;
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

// ============================================================================
// Step 4: リスクに応じた強制注入
// ============================================================================

/**
 * リスクレベルに応じて強制注入する事例を選定
 */
export function selectForcedInjections(
  current: NormalizedRequest,
  all_traces: RejectionTrace[],
  constitution_rules: ConstitutionRule[]
): {
  negative_precedents: RejectionTrace[];
  prohibition_rules: ConstitutionRule[];
  hlg_interventions: RejectionTrace[];
} {
  const negative_precedents: RejectionTrace[] = [];
  const prohibition_rules: ConstitutionRule[] = [];
  const hlg_interventions: RejectionTrace[] = [];

  // 高リスク時は拒否判例を強制注入
  if (current.governance.risk_level === 'high' || current.governance.risk_level === 'critical') {
    // 過去の拒否事例を取得
    negative_precedents.push(...all_traces.filter((t) => !t.correction_applied).slice(0, 5));

    // 禁止ルールを取得
    prohibition_rules.push(
      ...constitution_rules.filter((r) => r.status === 'active' && r.enforcement_level === 'high')
    );

    // HLG介入事例を取得
    hlg_interventions.push(
      ...all_traces.filter(
        (t) => t.generated_constraints.some((c) => c.requires_hlg_review)
      ).slice(0, 3)
    );
  }

  return {
    negative_precedents,
    prohibition_rules,
    hlg_interventions,
  };
}

// ============================================================================
// Step 5: 文脈圧縮（プロンプト構築）
// ============================================================================

/**
 * Constraint Capsule を生成
 * Traceを判定式に圧縮
 */
export function createConstraintCapsule(
  traces: RejectionTrace[],
  enforcement_level: 'low' | 'medium' | 'high'
): ConstraintCapsule {
  if (traces.length === 0) {
    return {
      capsule_id: randomUUID(),
      predicate: 'true',
      description: 'No constraints',
      source_trace_ids: [],
      applies_when: {},
      enforcement_level: 'low',
    };
  }

  // 共通パターンを抽出
  const intent_patterns = [...new Set(traces.map((t) => t.intent_normalized))];
  const operation_patterns = [...new Set(traces.map((t) => t.operation_signature))];

  // 判定式を生成（pseudo-code）
  const predicate = `
IF intent IN [${intent_patterns.join(', ')}]
   AND operation MATCHES [${operation_patterns.slice(0, 3).join(', ')}...]
THEN ${enforcement_level === 'high' ? 'DENY' : enforcement_level === 'medium' ? 'REQUIRE_APPROVAL' : 'WARN'}
  `.trim();

  return {
    capsule_id: randomUUID(),
    predicate,
    description: `Based on ${traces.length} past rejections of similar operations`,
    source_trace_ids: traces.map((t) => t.trace_id),
    applies_when: {
      intent_pattern: intent_patterns.length === 1 ? intent_patterns[0] : undefined,
      blast_radius: [...new Set(traces.map((t) => t.blast_radius))],
      risk_level: [...new Set(traces.map((t) => t.risk_level))],
    },
    enforcement_level,
  };
}

/**
 * Constitution Ruleを Constraint Capsule に変換
 */
export function constitutionToCapsule(rule: ConstitutionRule): ConstraintCapsule {
  return {
    capsule_id: rule.rule_id,
    predicate: `IF ${rule.applies_when.intent_pattern || 'ANY_INTENT'} THEN ${rule.constraint_type}`,
    description: rule.name,
    source_trace_ids: rule.source_trace_ids,
    applies_when: rule.applies_when,
    enforcement_level: rule.enforcement_level,
  };
}

/**
 * ICLプロンプトを構築
 */
export function buildICLPrompt(context: ICLInjectionContext): string {
  const { current_request, negative_precedents, prohibition_rules, allowed_output_types } = context;

  let prompt = `
You are an OS-level AI safety gatekeeper. Your role is to evaluate whether the following action should be permitted.

## Current Request
- Intent: ${current_request.intent}
- Operation: ${current_request.operation_signature}
- Blast Radius: ${current_request.blast_radius}
- Risk Level: ${current_request.risk_level}

`;

  // 高リスク時は拒否判例を強制注入
  if (negative_precedents && negative_precedents.length > 0) {
    prompt += `
## CRITICAL: Past Rejections (DO NOT approve actions matching these patterns)
`;
    negative_precedents.forEach((capsule, i) => {
      prompt += `
${i + 1}. ${capsule.description}
   Rule: ${capsule.predicate}
`;
    });
  }

  // 禁止ルール
  if (prohibition_rules && prohibition_rules.length > 0) {
    prompt += `
## System-Wide Prohibitions
`;
    prohibition_rules.forEach((capsule, i) => {
      prompt += `
${i + 1}. ${capsule.description}
   Rule: ${capsule.predicate}
`;
    });
  }

  // 出力形式の制約
  prompt += `
## Your Response MUST be one of the following:
${allowed_output_types.map((t) => `- ${t}`).join('\n')}

Provide your decision and reasoning.
`;

  return prompt;
}

// ============================================================================
// Dynamic Prompt Orchestrator（統合クラス）
// ============================================================================

export class DynamicPromptOrchestrator {
  constructor(
    private ledger_store: RejectionTrace[],
    private constitution_store: ConstitutionRule[]
  ) {}

  /**
   * メインのオーケストレーションフロー
    * 6ステップを実行してICLプロンプトを生成。
    *
    * @deprecated Prefer orchestrateAndDispatch() for production dispatch flow.
    *
    * NOTE:
    * - This is a low-level API that returns normalized and validation artifacts.
    * - Preferred production path is orchestrateAndDispatch() so only
    *   ValidatedDispatchRecord reaches external dispatch callbacks.
   */
  async orchestrate(raw_request: {
    intent: string;
    params: Record<string, any>;
    context: any;
  }): Promise<{
    normalized: NormalizedRequest;
    filtered_traces: RejectionTrace[];
    scored_traces: Array<{ trace: RejectionTrace; score: CausalSimilarityScore }>;
    injected_capsules: ConstraintCapsule[];
    icl_prompt: string;
    allowed_outputs: ICLOutputType[];
    dispatch_record: DispatchRecordEvent;
    dispatch_validation: DispatchValidationEvidence;
    validated_dispatch_record: ValidatedDispatchRecord;
  }> {
    // Step 1: 正規化
    const normalized = normalizeRequest(raw_request);

    // Step 2: 足切り（Hard Filter）
    const criteria: HardFilterCriteria = {
      exclude_capability_mismatch: true,
      exclude_scope_incompatible: true,
      exclude_corrected: true,
      max_risk_level: normalized.governance.risk_level,
      exclude_older_than_days: 90,
    };

    const filtered_traces = applyHardFilter(this.ledger_store, criteria, {
      intent: normalized.intent.intent_normalized,
      blast_radius: normalized.governance.blast_radius,
    });

    // Step 3: 因果的類似度の計算
    const scored_traces = filtered_traces
      .map((trace) => ({
        trace,
        score: calculateCausalSimilarity(normalized, trace),
      }))
      .sort((a, b) => b.score.total_score - a.score.total_score)
      .slice(0, 10); // Top 10

    // Step 4: リスクに応じた強制注入
    const forced = selectForcedInjections(normalized, this.ledger_store, this.constitution_store);

    // Step 5: 文脈圧縮（Constraint Capsule生成）
    const injected_capsules: ConstraintCapsule[] = [];

    if (forced.negative_precedents.length > 0) {
      injected_capsules.push(createConstraintCapsule(forced.negative_precedents, 'high'));
    }

    for (const rule of forced.prohibition_rules) {
      injected_capsules.push(constitutionToCapsule(rule));
    }

    // Step 6: 出力の型制約
    const allowed_outputs: ICLOutputType[] = [
      ICLOutputType.TRANSITION_REQUEST,
      ICLOutputType.REQUEST_EVIDENCE,
      ICLOutputType.ESCALATE_HLG,
      ICLOutputType.DENY,
      ICLOutputType.CONDITIONAL_APPROVAL,
    ];

    // ICL Injection Context を構築
    const icl_context: ICLInjectionContext = {
      current_request: {
        intent: normalized.intent.intent_normalized,
        operation_signature: normalized.action.signature_normalized,
        blast_radius: normalized.governance.blast_radius,
        risk_level: normalized.governance.risk_level,
      },
      negative_precedents: injected_capsules.filter((c) => c.enforcement_level === 'high'),
      prohibition_rules: injected_capsules.filter((c) => c.enforcement_level === 'high'),
      allowed_output_types: allowed_outputs,
    };

    // プロンプト構築
    const icl_prompt = buildICLPrompt(icl_context);

    // Step 6.5: pre-dispatch validation (fail-closed)
    let dispatch_record: DispatchRecordEvent;
    let dispatch_validation: DispatchValidationEvidence;
    let validated_dispatch_record: ValidatedDispatchRecord;

    try {
      dispatch_record = this.buildDispatchRecordEvent(raw_request.context, normalized, {
        filtered_count: filtered_traces.length,
        injected_count: injected_capsules.length,
        allowed_outputs,
      });

      dispatch_validation = this.validateAndAuditDispatchRecord(dispatch_record);
      validated_dispatch_record = ValidatedDispatchRecord.fromValidated(
        dispatch_record,
        dispatch_validation
      );
    } catch (error) {
      this.appendDispatchAuditLog(
        this.buildDispatchFailureAuditLine(error, raw_request.context, normalized.request_id)
      );
      throw error;
    }

    return {
      normalized,
      filtered_traces,
      scored_traces,
      injected_capsules,
      icl_prompt,
      allowed_outputs,
      dispatch_record,
      dispatch_validation,
      validated_dispatch_record,
    };
  }

  async orchestrateAndDispatch(
    raw_request: {
      intent: string;
      params: Record<string, any>;
      context: any;
    },
    dispatch: (record: ValidatedDispatchRecord) => Promise<void> | void
  ): Promise<{
    normalized: NormalizedRequest;
    filtered_traces: RejectionTrace[];
    scored_traces: Array<{ trace: RejectionTrace; score: CausalSimilarityScore }>;
    injected_capsules: ConstraintCapsule[];
    icl_prompt: string;
    allowed_outputs: ICLOutputType[];
    dispatch_record: DispatchRecordEvent;
    dispatch_validation: DispatchValidationEvidence;
    validated_dispatch_record: ValidatedDispatchRecord;
  }> {
    const result = await this.orchestrate(raw_request);
    await dispatch(result.validated_dispatch_record);
    return result;
  }

  private buildDispatchRecordEvent(
    raw_context: unknown,
    normalized: NormalizedRequest,
    meta: {
      filtered_count: number;
      injected_count: number;
      allowed_outputs: ICLOutputType[];
    }
  ): DispatchRecordEvent {
    const ctx = this.extractDispatchContext(raw_context);

    return {
      event_id: `evt-${normalized.request_id}`,
      event_type: 'dispatch_recorded',
      timestamp: new Date().toISOString(),
      trace_id: ctx.trace_id,
      correlation_id: ctx.correlation_id,
      run_id: ctx.run_id,
      workflow_id: 'dynamic_prompt_orchestrator',
      stage_id: 'dispatch',
      week_id: ctx.week_id,
      state: 'PASS',
      severity: 'info',
      actor: {
        role: 'system',
        id: 'dynamic_prompt_orchestrator',
      },
      evidence: {
        normalized_intent: normalized.intent.intent_normalized,
        operation_signature: normalized.action.signature_normalized,
        blast_radius: normalized.governance.blast_radius,
        risk_level: normalized.governance.risk_level,
        filtered_trace_count: meta.filtered_count,
        injected_capsule_count: meta.injected_count,
      },
      payload: {
        allowed_outputs: meta.allowed_outputs,
      },
      idempotency_key: `${ctx.week_id}:dispatch:${ctx.run_id}`,
    };
  }

  private extractDispatchContext(raw_context: unknown): DispatchContextFields {
    if (!raw_context || typeof raw_context !== 'object') {
      throw new Error('DISPATCH_CONTEXT_REQUIRED: context object is missing for pre-dispatch validation.');
    }

    const obj = raw_context as Record<string, unknown>;
    const required: Array<keyof DispatchContextFields> = ['week_id', 'trace_id', 'correlation_id', 'run_id'];
    const out: Partial<DispatchContextFields> = {};

    for (const key of required) {
      const value = obj[key];
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`DISPATCH_CONTEXT_REQUIRED: missing or invalid context.${key}`);
      }
      out[key] = value;
    }

    return out as DispatchContextFields;
  }

  private validateAndAuditDispatchRecord(event_payload: DispatchRecordEvent): DispatchValidationEvidence {
    const validation = validateWorkflowEvent(event_payload);
    if (!validation.ok) {
      throw new Error(`EVENT_SCHEMA_VALIDATION_FAILED: ${validation.errors.join('; ')}`);
    }

    const audit_line: DispatchAuditLine = {
      timestamp: new Date().toISOString(),
      validator: 'event_schema.v0.1.json',
      workflow_id: 'dynamic_prompt_orchestrator',
      stage_id: 'dispatch',
      event_id: event_payload.event_id,
      week_id: event_payload.week_id,
      run_id: event_payload.run_id,
      schema_validated: true,
      schema_errors: [],
    };

    const audit_log_path = this.appendDispatchAuditLog(audit_line);

    return {
      schema_validated: true,
      schema_errors: [],
      audit_log_path,
    };
  }

  private appendDispatchAuditLog(audit_line: Record<string, unknown>): string {
    const repo_root = path.resolve(__dirname, '..');
    const log_dir = path.join(repo_root, 'logs');
    const log_path = path.join(log_dir, 'dynamic_prompt_orchestrator.dispatch.audit.jsonl');

    if (!fs.existsSync(log_dir)) {
      fs.mkdirSync(log_dir, { recursive: true });
    }

    fs.appendFileSync(log_path, `${JSON.stringify(audit_line)}\n`, 'utf8');
    return log_path;
  }

  private buildDispatchFailureAuditLine(
    error: unknown,
    raw_context: unknown,
    request_id: string
  ): DispatchAuditLine {
    const message = error instanceof Error ? error.message : String(error);
    const ctx = raw_context && typeof raw_context === 'object'
      ? (raw_context as Record<string, unknown>)
      : {};

    const event_id_suffix = typeof ctx.run_id === 'string' && ctx.run_id.trim().length > 0
      ? ctx.run_id
      : request_id;

    const schema_errors = message.startsWith('EVENT_SCHEMA_VALIDATION_FAILED: ')
      ? message.replace('EVENT_SCHEMA_VALIDATION_FAILED: ', '').split('; ').filter((item) => item.length > 0)
      : [];

    let failure_reason = 'unknown_dispatch_failure';
    if (message.startsWith('DISPATCH_CONTEXT_REQUIRED:')) {
      failure_reason = 'missing_required_context';
    } else if (message.startsWith('EVENT_SCHEMA_VALIDATION_FAILED:')) {
      failure_reason = 'schema_validation_failed';
    }

    return {
      timestamp: new Date().toISOString(),
      validator: 'event_schema.v0.1.json',
      workflow_id: 'dynamic_prompt_orchestrator',
      stage_id: 'dispatch',
      event_id: `evt-failed-${event_id_suffix}`,
      week_id: typeof ctx.week_id === 'string' ? ctx.week_id : undefined,
      run_id: typeof ctx.run_id === 'string' ? ctx.run_id : undefined,
      schema_validated: false,
      schema_errors,
      failure_reason,
    };
  }
}
