/**
 * contract/ledger_icl.ts
 * 
 * Ledger-Based In-Context Learning (ICL) Framework
 * 因果的ゲートと台帳に基づく自己進化OS
 * 
 * このモジュールは、LLMの「破滅的忘却」を回避し、失敗を「重みの更新」ではなく
 * 「可監査な制度への変更要求」として扱う堅牢なシステムを提供します。
 * 
 * 4つのフェーズ:
 * 1. 語彙の固定（Enum & Schema）
 * 2. Traceの記録とハードフィルタリング
 * 3. 因果的類似度の計算と動的プロンプト注入
 * 4. 暫定制約から正式Constitutionへの昇格
 * 
 * このファイルはフェーズ1の実装を担当します。
 */

import { AntigravityEvent, signEvent, LegitimacyTier } from './proof';
import { BlastRadius } from './os_ai_interface';

// ============================================================================
// PHASE 1: 最小語彙（Enum）とスキーマの固定
// ============================================================================

/**
 * 拒否・失敗フェーズ
 * システムのどこで処理が停止したかを表す
 * 
 * 設計原則:
 * - 各フェーズは因果的に順序付けられている
 * - 後のフェーズでの失敗は、前のフェーズを通過したことを意味する
 */
export enum RejectionPhase {
  /**
   * 構造型チェック段階での失敗
   * 例: 必須フィールド欠落、型不一致、スキーマ違反
   */
  STRUCTURAL_TYPING = 'STRUCTURAL_TYPING',

  /**
   * ゲート評価段階での失敗
   * 例: 事前条件の不成立、権限不足、リソース上限
   */
  GATE_EVALUATION = 'GATE_EVALUATION',

  /**
   * 実行前チェック段階での失敗
   * 例: 外部依存の欠落、状態の不整合、タイムアウト
   */
  EXECUTION_PRECHECK = 'EXECUTION_PRECHECK',

  /**
   * 実行中のエラー
   * 例: ランタイムエラー、予期しない例外、リソース枯渇
   */
  EXECUTION_RUNTIME = 'EXECUTION_RUNTIME',

  /**
   * 検証段階での失敗
   * 例: 状態不一致、副作用の不整合、予測との乖離
   */
  VERIFICATION = 'VERIFICATION',

  /**
   * 承認待ち（人間の判断で拒否された）
   * 例: ユーザーによる明示的な拒否、タイムアウト
   */
  APPROVAL_REJECTED = 'APPROVAL_REJECTED',

  /**
   * HLG（上位機関）による介入
   * 例: 監査部門の差し止め、セキュリティチームの緊急停止
   */
  HLG_INTERVENTION = 'HLG_INTERVENTION',
}

/**
 * 拒否・失敗クラス
 * なぜ処理を止めたかの根本原因分類
 * 
 * 設計原則:
 * - この4つのクラスは相互排他的
 * - 複合的な理由の場合は、最も支配的な理由を選択
 * - この分類は統計・集計・ルール生成の基礎となる
 */
export enum RejectionClass {
  /**
   * 承認の欠如
   * 必要な承認が得られていない（人間、システム、HLG）
   */
  MISSING_APPROVAL = 'MISSING_APPROVAL',

  /**
   * 証拠不足
   * 判断を下すための情報が不十分
   * 例: dry-runの結果が不明、既知の事例なし、予測不能
   */
  INSUFFICIENT_EVIDENCE = 'INSUFFICIENT_EVIDENCE',

  /**
   * スコープ超過
   * 権限、リソース、BlastRadiusなどの制限を越えている
   */
  SCOPE_OVERREACH = 'SCOPE_OVERREACH',

  /**
   * 意図の曖昧性
   * AIの意図が明確でない、または複数解釈可能
   * パラメータの曖昧性、セマンティクスの不一致を含む
   */
  INTENT_AMBIGUOUS = 'INTENT_AMBIGUOUS',
}

/**
 * 制約タイプ
 * 次回以降の実行を縛るためのルール
 * 
 * 設計原則:
 * - 制約は宣言的（検査可能）
 * - システムが自動的に適用・検証できる
 * - 段階的に強化される（初回は警告、再発で禁止）
 */
export enum ConstraintType {
  /**
   * 承認を必須化
   * 次回同様の操作には人間またはHLGの承認が必要
   */
  REQUIRE_APPROVAL = 'REQUIRE_APPROVAL',

  /**
   * 証拠を必須化
   * dry-run成功、既知の成功事例、シミュレーション結果などを要求
   */
  REQUIRE_EVIDENCE = 'REQUIRE_EVIDENCE',

  /**
   * スコープが不明確な場合は拒否
   * BlastRadiusが推定できない場合は実行しない
   */
  DENY_IF_SCOPE_UNCLEAR = 'DENY_IF_SCOPE_UNCLEAR',

  /**
   * 曖昧度がしきい値を超えた場合はHLGへエスカレーション
   * AIの確信度が一定以下の場合、人間の判断を仰ぐ
   */
  ESCALATE_IF_AMBIGUITY_GT = 'ESCALATE_IF_AMBIGUITY_GT',

  /**
   * 特定の操作シグネチャを禁止
   * 完全に禁止された操作パターン
   */
  DENY_OPERATION = 'DENY_OPERATION',

  /**
   * リソース上限を設定
   * CPU、メモリ、ストレージ、コストなどの上限
   */
  SET_RESOURCE_LIMIT = 'SET_RESOURCE_LIMIT',

  /**
   * タイムアウトを設定
   * 承認待ち、実行、検証の時間制限
   */
  SET_TIMEOUT = 'SET_TIMEOUT',

  /**
   * 監査ログを強制
   * 特定の操作に対して詳細ログを記録
   */
  ENFORCE_AUDIT_LOG = 'ENFORCE_AUDIT_LOG',

  /**
   * 警告のみ（実行は許可）
   * 初回違反時の柔軟な対応
   */
  WARN_ONLY = 'WARN_ONLY',
}

/**
 * フェーズ1: RejectionClass → ConstraintType 変換表 v1
 * 
 * この変換表は、失敗の原因から次回の制約を決定論的に導出します。
 * システムの「学習」の第一歩となる重要なマッピングです。
 * 
 * 設計原則:
 * - 1つのRejectionClassに対して複数のConstraintTypeを生成可能
 * - 初回は緩い制約（WARN_ONLY）、再発時に厳格化
 * - コンテキスト（BlastRadius, リスクレベル）に応じて変動
 */
export interface ConstraintGenerationRule {
  /** 対象となる拒否クラス */
  from_rejection_class: RejectionClass;

  /** 生成される制約タイプ（優先度順） */
  to_constraint_types: ConstraintType[];

  /** この変換が適用される条件 */
  conditions: {
    /** 初回違反時に適用 */
    on_first_occurrence?: boolean;

    /** N回以上再発時に適用 */
    on_recurrence_gte?: number;

    /** 特定のBlastRadiusでのみ適用 */
    blast_radius?: BlastRadius[];

    /** リスクレベルでのみ適用 */
    risk_level?: ('low' | 'medium' | 'high' | 'critical')[];
  };

  /** 人間が読める説明 */
  rationale: string;

  /** HLGへのエスカレーションが必要か */
  requires_hlg_review: boolean;
}

/**
 * フェーズ1: 決め打ち変換表 v1
 * 
 * この表は運用開始の起点となります。
 * フェーズ4で統計データに基づいて自動的に更新・拡張されます。
 */
export const REJECTION_TO_CONSTRAINT_MAP_V1: ConstraintGenerationRule[] = [
  // ─────────────────────────────────────────────────────────────
  // MISSING_APPROVAL のルール
  // ─────────────────────────────────────────────────────────────
  {
    from_rejection_class: RejectionClass.MISSING_APPROVAL,
    to_constraint_types: [ConstraintType.WARN_ONLY, ConstraintType.ENFORCE_AUDIT_LOG],
    conditions: {
      on_first_occurrence: true,
      blast_radius: ['SELF'],
    },
    rationale: '初回のSELFスコープ承認漏れは警告のみ。監査ログは強制。',
    requires_hlg_review: false,
  },
  {
    from_rejection_class: RejectionClass.MISSING_APPROVAL,
    to_constraint_types: [ConstraintType.REQUIRE_APPROVAL, ConstraintType.ENFORCE_AUDIT_LOG],
    conditions: {
      on_first_occurrence: true,
      blast_radius: ['TENANT', 'GLOBAL'],
    },
    rationale: 'TENANT/GLOBALスコープは初回から承認必須。',
    requires_hlg_review: false,
  },
  {
    from_rejection_class: RejectionClass.MISSING_APPROVAL,
    to_constraint_types: [ConstraintType.REQUIRE_APPROVAL, ConstraintType.SET_TIMEOUT],
    conditions: {
      on_recurrence_gte: 2,
    },
    rationale: '2回以上再発した場合は承認必須化し、タイムアウトを設定。',
    requires_hlg_review: false,
  },
  {
    from_rejection_class: RejectionClass.MISSING_APPROVAL,
    to_constraint_types: [ConstraintType.DENY_OPERATION],
    conditions: {
      on_recurrence_gte: 5,
      risk_level: ['high', 'critical'],
    },
    rationale: '高リスク操作で5回以上再発した場合は操作を禁止。HLG判断が必要。',
    requires_hlg_review: true,
  },

  // ─────────────────────────────────────────────────────────────
  // INSUFFICIENT_EVIDENCE のルール
  // ─────────────────────────────────────────────────────────────
  {
    from_rejection_class: RejectionClass.INSUFFICIENT_EVIDENCE,
    to_constraint_types: [ConstraintType.WARN_ONLY],
    conditions: {
      on_first_occurrence: true,
      risk_level: ['low'],
    },
    rationale: '低リスク操作の初回証拠不足は警告のみ。',
    requires_hlg_review: false,
  },
  {
    from_rejection_class: RejectionClass.INSUFFICIENT_EVIDENCE,
    to_constraint_types: [ConstraintType.REQUIRE_EVIDENCE],
    conditions: {
      on_first_occurrence: true,
      risk_level: ['medium', 'high', 'critical'],
    },
    rationale: '中リスク以上は初回から証拠必須（dry-run, 既知事例など）。',
    requires_hlg_review: false,
  },
  {
    from_rejection_class: RejectionClass.INSUFFICIENT_EVIDENCE,
    to_constraint_types: [ConstraintType.REQUIRE_EVIDENCE, ConstraintType.REQUIRE_APPROVAL],
    conditions: {
      on_recurrence_gte: 3,
    },
    rationale: '3回以上再発した場合は証拠+承認の二重チェック。',
    requires_hlg_review: false,
  },
  {
    from_rejection_class: RejectionClass.INSUFFICIENT_EVIDENCE,
    to_constraint_types: [ConstraintType.DENY_OPERATION],
    conditions: {
      on_recurrence_gte: 5,
      blast_radius: ['GLOBAL'],
    },
    rationale: 'GLOBALスコープで5回以上証拠不足の場合は禁止。システム設計の見直しが必要。',
    requires_hlg_review: true,
  },

  // ─────────────────────────────────────────────────────────────
  // SCOPE_OVERREACH のルール
  // ─────────────────────────────────────────────────────────────
  {
    from_rejection_class: RejectionClass.SCOPE_OVERREACH,
    to_constraint_types: [ConstraintType.DENY_IF_SCOPE_UNCLEAR, ConstraintType.ENFORCE_AUDIT_LOG],
    conditions: {
      on_first_occurrence: true,
    },
    rationale: 'スコープ超過は初回から拒否。将来的なオーバーリーチを防ぐ。',
    requires_hlg_review: false,
  },
  {
    from_rejection_class: RejectionClass.SCOPE_OVERREACH,
    to_constraint_types: [ConstraintType.SET_RESOURCE_LIMIT],
    conditions: {
      on_recurrence_gte: 2,
    },
    rationale: '2回以上再発した場合は明示的なリソース上限を設定。',
    requires_hlg_review: false,
  },
  {
    from_rejection_class: RejectionClass.SCOPE_OVERREACH,
    to_constraint_types: [ConstraintType.DENY_OPERATION, ConstraintType.REQUIRE_APPROVAL],
    conditions: {
      on_recurrence_gte: 3,
      blast_radius: ['TENANT', 'GLOBAL'],
    },
    rationale: 'TENANT/GLOBALスコープで3回以上再発した場合は操作禁止+HLG承認必須。',
    requires_hlg_review: true,
  },

  // ─────────────────────────────────────────────────────────────
  // INTENT_AMBIGUOUS のルール
  // ─────────────────────────────────────────────────────────────
  {
    from_rejection_class: RejectionClass.INTENT_AMBIGUOUS,
    to_constraint_types: [ConstraintType.ESCALATE_IF_AMBIGUITY_GT],
    conditions: {
      on_first_occurrence: true,
    },
    rationale: '意図不明確な操作は初回からHLGへエスカレーション閾値を設定。',
    requires_hlg_review: false,
  },
  {
    from_rejection_class: RejectionClass.INTENT_AMBIGUOUS,
    to_constraint_types: [ConstraintType.REQUIRE_APPROVAL, ConstraintType.ESCALATE_IF_AMBIGUITY_GT],
    conditions: {
      on_recurrence_gte: 2,
      risk_level: ['medium', 'high', 'critical'],
    },
    rationale: '中リスク以上で2回以上再発した場合は承認必須化。',
    requires_hlg_review: false,
  },
  {
    from_rejection_class: RejectionClass.INTENT_AMBIGUOUS,
    to_constraint_types: [ConstraintType.DENY_OPERATION],
    conditions: {
      on_recurrence_gte: 4,
    },
    rationale: '4回以上曖昧な意図が検出された場合、AIのセマンティクスモデルに問題がある可能性。操作禁止。',
    requires_hlg_review: true,
  },
];

// ============================================================================
// PHASE 2: Traceの記録とハードフィルタリング
// ============================================================================

/**
 * 修復可能性（Repairability）
 * 失敗・拒否が修復可能かどうかを分類
 */
export enum Repairability {
  /** 自動修復可能（パラメータ調整、リトライで解決） */
  AUTO_REPAIRABLE = 'AUTO_REPAIRABLE',

  /** 人間の介入で修復可能（承認、証拠提出など） */
  HUMAN_REPAIRABLE = 'HUMAN_REPAIRABLE',

  /** HLG（上位機関）の判断が必要 */
  HLG_REQUIRED = 'HLG_REQUIRED',

  /** 修復不可能（設計上の制約、システム限界） */
  NOT_REPAIRABLE = 'NOT_REPAIRABLE',
}

/**
 * エラー・拒否Traceの構造化オブジェクト
 * 
 * 設計原則:
 * - 全文ログではなく、集計・検索可能な構造化データ
 * - 因果的類似度計算に必要な情報を保持
 * - 匿名化・圧縮可能（GDPR対応）
 */
export interface RejectionTrace {
  /** トレースID（UUID） */
  trace_id: string;

  /** タイムスタンプ（ISO8601） */
  timestamp: string;

  /** どのフェーズで停止したか */
  rejection_phase: RejectionPhase;

  /** なぜ停止したか（根本原因） */
  rejection_class: RejectionClass;

  /** 修復可能性 */
  repairability: Repairability;

  /** 再発監視のためのコード（統計集計用キー） */
  primary_reason_code: string;

  /** 意図（正規化済み） */
  intent_normalized: string;

  /** 操作シグネチャ（ハッシュ化可能） */
  operation_signature: string;

  /** 影響範囲 */
  blast_radius: BlastRadius;

  /** リスクレベル */
  risk_level: 'low' | 'medium' | 'high' | 'critical';

  /** 関連する制約（既存のConstitutionルール） */
  related_constraints: string[];

  /** 生成された暫定制約（このTraceから導出） */
  generated_constraints: GeneratedConstraint[];

  /** エラーメッセージ（人間向け、分析用） */
  error_message: string;

  /** コンテキスト情報（最小限に圧縮、匿名化可能） */
  context: {
    actor_id?: string;
    session_id?: string;
    request_id?: string;
    failure_event_id?: string;
    request_params?: Record<string, any>;
  };

  /** 訂正が適用されたか（Phase 3で更新される） */
  correction_applied: boolean;

  /** 訂正イベントID（correction.ts連携） */
  correction_event_id?: string;
}

/**
 * 生成された制約（暫定）
 * 後にConstitutionへ昇格される可能性がある
 */
export interface GeneratedConstraint {
  /** 制約タイプ */
  constraint_type: ConstraintType;

  /** 制約の具体的な値・閾値 */
  constraint_value?: any;

  /** 生成理由 */
  rationale: string;

  /** 適用されたルール */
  applied_rule: string;

  /** 信頼度スコア（0.0 - 1.0） */
  confidence: number;

  /** HLGレビューが必要か */
  requires_hlg_review: boolean;
}

/**
 * ハードフィルタ条件
 * 類似度計算の前に明示的に除外する条件
 */
export interface HardFilterCriteria {
  /** 能力（capability）の不一致を除外 */
  exclude_capability_mismatch: boolean;

  /** スコープクラスの非互換を除外 */
  exclude_scope_incompatible: boolean;

  /** すでに訂正済みの事例を除外 */
  exclude_corrected: boolean;

  /** 指定された修復可能性のみを含む */
  include_repairability?: Repairability[];

  /** 指定されたリスクレベル以下のみを含む */
  max_risk_level?: 'low' | 'medium' | 'high' | 'critical';

  /** 指定された日数より古い事例を除外 */
  exclude_older_than_days?: number;
}

// ============================================================================
// PHASE 3: 因果的類似度とプロンプト注入（型定義）
// ============================================================================

/**
 * 因果的類似度スコア
 * 意味的類似度だけでなく、因果的な関連性を加味
 */
export interface CausalSimilarityScore {
  /** トータルスコア（0.0 - 1.0） */
  total_score: number;

  /** 内訳 */
  breakdown: {
    /** 意図の類似度 */
    intent_similarity: number;

    /** 操作の類似度 */
    operation_similarity: number;

    /** 制約の類似度 */
    constraint_similarity: number;

    /** リスクの類似度 */
    risk_similarity: number;

    /** 結果の類似度（成功/失敗パターン） */
    outcome_similarity: number;
  };

  /** 重み付け設定 */
  weights: {
    intent: number;
    operation: number;
    constraint: number;
    risk: number;
    outcome: number;
  };
}

/**
 * Constraint Capsule（制約カプセル）
 * ICLプロンプトに注入する際の圧縮形式
 * 
 * 設計原則:
 * - 最小限の情報で最大限の制約を表現
 * - LLMのコンテキスト長を節約
 * - 判定式として機械的に評価可能
 */
export interface ConstraintCapsule {
  /** カプセルID */
  capsule_id: string;

  /** コンパクトな判定式（pseudo-code） */
  predicate: string;

  /** 人間向けの説明（短い） */
  description: string;

  /** ソースとなったTrace ID（監査用） */
  source_trace_ids: string[];

  /** 適用される条件 */
  applies_when: {
    intent_pattern?: string;
    operation_pattern?: string;
    blast_radius?: BlastRadius[];
    risk_level?: ('low' | 'medium' | 'high' | 'critical')[];
  };

  /** 強制度（low: 警告, medium: 承認要求, high: 拒否） */
  enforcement_level: 'low' | 'medium' | 'high';
}

/**
 * ICLプロンプトへの注入コンテキスト
 */
export interface ICLInjectionContext {
  /** 現在のリクエスト情報 */
  current_request: {
    intent: string;
    operation_signature: string;
    blast_radius: BlastRadius;
    risk_level: 'low' | 'medium' | 'high' | 'critical';
  };

  /** 低リスク時に注入する成功事例 */
  success_precedents?: ConstraintCapsule[];

  /** 高リスク時に強制注入する拒否判例 */
  negative_precedents?: ConstraintCapsule[];

  /** 最新の禁止ルール */
  prohibition_rules?: ConstraintCapsule[];

  /** HLG介入例 */
  hlg_interventions?: ConstraintCapsule[];

  /** 許可される出力タイプ（型制約） */
  allowed_output_types: ICLOutputType[];
}

/**
 * ICLの出力タイプ（型制約）
 * 自由回答ではなく、決められた選択肢のみ
 */
export enum ICLOutputType {
  /** 状態遷移リクエスト（承認） */
  TRANSITION_REQUEST = 'TRANSITION_REQUEST',

  /** 証拠の要求 */
  REQUEST_EVIDENCE = 'REQUEST_EVIDENCE',

  /** HLGへのエスカレーション */
  ESCALATE_HLG = 'ESCALATE_HLG',

  /** 拒否 */
  DENY = 'DENY',

  /** 条件付き承認 */
  CONDITIONAL_APPROVAL = 'CONDITIONAL_APPROVAL',
}

// ============================================================================
// PHASE 4: Constitution昇格（型定義）
// ============================================================================

/**
 * Constitution Rule（正式ルール）
 * 暫定制約から昇格した、システム全体に適用される「法律」
 */
export interface ConstitutionRule {
  /** ルールID */
  rule_id: string;

  /** バージョン */
  version: number;

  /** ルール名 */
  name: string;

  /** 制約タイプ */
  constraint_type: ConstraintType;

  /** 制約の具体値 */
  constraint_value: any;

  /** 適用条件 */
  applies_when: {
    intent_pattern?: string;
    operation_pattern?: string;
    blast_radius?: BlastRadius[];
    risk_level?: ('low' | 'medium' | 'high' | 'critical')[];
  };

  /** 強制度 */
  enforcement_level: 'low' | 'medium' | 'high';

  /** 昇格理由 */
  promotion_rationale: string;

  /** 元となったTrace IDリスト */
  source_trace_ids: string[];

  /** 再発回数（統計） */
  recurrence_count: number;

  /** 最終更新日時 */
  last_updated: string;

  /** HLGによる承認済みか */
  hlg_approved: boolean;

  /** HLG承認日時 */
  hlg_approval_timestamp?: string;

  /** 有効化状態 */
  status: 'draft' | 'active' | 'deprecated';
}

/**
 * 昇格条件
 * 暫定制約がConstitutionへ昇格される条件
 */
export interface PromotionCriteria {
  /** 同一primary_reason_codeの再発回数閾値 */
  min_recurrence_count: number;

  /** 高リスク帯で重大事故回避に寄与した回数 */
  min_critical_avoidance_count?: number;

  /** HLGが同じ判断をした回数 */
  min_hlg_consensus_count?: number;

  /** 信頼度スコアの閾値 */
  min_confidence_score?: number;

  /** 最小観測期間（日数） */
  min_observation_days?: number;
}

// ============================================================================
// 実用関数（フェーズ1: マッピング適用）
// ============================================================================

/**
 * RejectionClassからConstraintTypeを生成
 * 
 * @param rejection_class - 拒否クラス
 * @param context - コンテキスト情報
 * @returns 生成された制約リスト
 */
export function generateConstraints(
  rejection_class: RejectionClass,
  context: {
    recurrence_count: number;
    blast_radius: BlastRadius;
    risk_level: 'low' | 'medium' | 'high' | 'critical';
  }
): GeneratedConstraint[] {
  const results: GeneratedConstraint[] = [];

  // 該当するルールをフィルタリング
  const applicable_rules = REJECTION_TO_CONSTRAINT_MAP_V1.filter((rule) => {
    if (rule.from_rejection_class !== rejection_class) return false;

    const conditions = rule.conditions;

    // 初回条件チェック
    if (conditions.on_first_occurrence && context.recurrence_count !== 1) {
      return false;
    }

    // 再発回数チェック
    if (conditions.on_recurrence_gte && context.recurrence_count < conditions.on_recurrence_gte) {
      return false;
    }

    // BlastRadiusチェック
    if (conditions.blast_radius && !conditions.blast_radius.includes(context.blast_radius)) {
      return false;
    }

    // リスクレベルチェック
    if (conditions.risk_level && !conditions.risk_level.includes(context.risk_level)) {
      return false;
    }

    return true;
  });

  // 制約を生成
  for (const rule of applicable_rules) {
    for (const constraint_type of rule.to_constraint_types) {
      results.push({
        constraint_type,
        constraint_value: undefined, // TODO: ルールごとに具体値を設定
        rationale: rule.rationale,
        applied_rule: `${rule.from_rejection_class} -> ${constraint_type}`,
        confidence: 1.0, // v1では決め打ちなので信頼度は1.0
        requires_hlg_review: rule.requires_hlg_review,
      });
    }
  }

  return results;
}

/**
 * RejectionTraceをLedgerに記録
 * proof.tsのイベントチェーンに統合
 * 
 * @param trace - 拒否トレース
 * @param prev_hash - 前のイベントハッシュ
 * @returns AntigravityEvent
 */
export function recordRejectionTrace(
  trace: RejectionTrace,
  prev_hash: string
): AntigravityEvent {
  return signEvent(
    {
      event_type: 'REJECTION_TRACE',
      trace,
    },
    prev_hash,
    'L1' as LegitimacyTier,
    'ledger-icl'
  );
}

/**
 * ハードフィルタを適用
 * 類似度計算の前に候補を絞り込む
 * 
 * @param traces - すべてのトレース
 * @param criteria - フィルタ条件
 * @param current_request - 現在のリクエスト
 * @returns フィルタリング後のトレースリスト
 */
export function applyHardFilter(
  traces: RejectionTrace[],
  criteria: HardFilterCriteria,
  current_request: {
    intent: string;
    blast_radius: BlastRadius;
  }
): RejectionTrace[] {
  return traces.filter((trace) => {
    // 訂正済みを除外
    if (criteria.exclude_corrected && trace.correction_applied) {
      return false;
    }

    // スコープ不一致を除外（簡略版）
    if (criteria.exclude_scope_incompatible && trace.blast_radius !== current_request.blast_radius) {
      return false;
    }

    // 修復可能性フィルタ
    if (criteria.include_repairability && !criteria.include_repairability.includes(trace.repairability)) {
      return false;
    }

    // リスクレベルフィルタ
    if (criteria.max_risk_level) {
      const risk_order = ['low', 'medium', 'high', 'critical'];
      const max_index = risk_order.indexOf(criteria.max_risk_level);
      const trace_index = risk_order.indexOf(trace.risk_level);
      if (trace_index > max_index) {
        return false;
      }
    }

    // 日付フィルタ
    if (criteria.exclude_older_than_days) {
      const trace_date = new Date(trace.timestamp);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - criteria.exclude_older_than_days);
      if (trace_date < cutoff) {
        return false;
      }
    }

    return true;
  });
}

// ============================================================================
// エクスポート完了
// ============================================================================
// すべての型とenumは既にexportされています
