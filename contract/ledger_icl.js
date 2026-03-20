"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ICLOutputType = exports.Repairability = exports.REJECTION_TO_CONSTRAINT_MAP_V1 = exports.ConstraintType = exports.RejectionClass = exports.RejectionPhase = void 0;
exports.generateConstraints = generateConstraints;
exports.recordRejectionTrace = recordRejectionTrace;
exports.applyHardFilter = applyHardFilter;
const proof_1 = require("./proof");
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
var RejectionPhase;
(function (RejectionPhase) {
    /**
     * 構造型チェック段階での失敗
     * 例: 必須フィールド欠落、型不一致、スキーマ違反
     */
    RejectionPhase["STRUCTURAL_TYPING"] = "STRUCTURAL_TYPING";
    /**
     * ゲート評価段階での失敗
     * 例: 事前条件の不成立、権限不足、リソース上限
     */
    RejectionPhase["GATE_EVALUATION"] = "GATE_EVALUATION";
    /**
     * 実行前チェック段階での失敗
     * 例: 外部依存の欠落、状態の不整合、タイムアウト
     */
    RejectionPhase["EXECUTION_PRECHECK"] = "EXECUTION_PRECHECK";
    /**
     * 実行中のエラー
     * 例: ランタイムエラー、予期しない例外、リソース枯渇
     */
    RejectionPhase["EXECUTION_RUNTIME"] = "EXECUTION_RUNTIME";
    /**
     * 検証段階での失敗
     * 例: 状態不一致、副作用の不整合、予測との乖離
     */
    RejectionPhase["VERIFICATION"] = "VERIFICATION";
    /**
     * 承認待ち（人間の判断で拒否された）
     * 例: ユーザーによる明示的な拒否、タイムアウト
     */
    RejectionPhase["APPROVAL_REJECTED"] = "APPROVAL_REJECTED";
    /**
     * HLG（上位機関）による介入
     * 例: 監査部門の差し止め、セキュリティチームの緊急停止
     */
    RejectionPhase["HLG_INTERVENTION"] = "HLG_INTERVENTION";
})(RejectionPhase || (exports.RejectionPhase = RejectionPhase = {}));
/**
 * 拒否・失敗クラス
 * なぜ処理を止めたかの根本原因分類
 *
 * 設計原則:
 * - この4つのクラスは相互排他的
 * - 複合的な理由の場合は、最も支配的な理由を選択
 * - この分類は統計・集計・ルール生成の基礎となる
 */
var RejectionClass;
(function (RejectionClass) {
    /**
     * 承認の欠如
     * 必要な承認が得られていない（人間、システム、HLG）
     */
    RejectionClass["MISSING_APPROVAL"] = "MISSING_APPROVAL";
    /**
     * 証拠不足
     * 判断を下すための情報が不十分
     * 例: dry-runの結果が不明、既知の事例なし、予測不能
     */
    RejectionClass["INSUFFICIENT_EVIDENCE"] = "INSUFFICIENT_EVIDENCE";
    /**
     * スコープ超過
     * 権限、リソース、BlastRadiusなどの制限を越えている
     */
    RejectionClass["SCOPE_OVERREACH"] = "SCOPE_OVERREACH";
    /**
     * 意図の曖昧性
     * AIの意図が明確でない、または複数解釈可能
     * パラメータの曖昧性、セマンティクスの不一致を含む
     */
    RejectionClass["INTENT_AMBIGUOUS"] = "INTENT_AMBIGUOUS";
})(RejectionClass || (exports.RejectionClass = RejectionClass = {}));
/**
 * 制約タイプ
 * 次回以降の実行を縛るためのルール
 *
 * 設計原則:
 * - 制約は宣言的（検査可能）
 * - システムが自動的に適用・検証できる
 * - 段階的に強化される（初回は警告、再発で禁止）
 */
var ConstraintType;
(function (ConstraintType) {
    /**
     * 承認を必須化
     * 次回同様の操作には人間またはHLGの承認が必要
     */
    ConstraintType["REQUIRE_APPROVAL"] = "REQUIRE_APPROVAL";
    /**
     * 証拠を必須化
     * dry-run成功、既知の成功事例、シミュレーション結果などを要求
     */
    ConstraintType["REQUIRE_EVIDENCE"] = "REQUIRE_EVIDENCE";
    /**
     * スコープが不明確な場合は拒否
     * BlastRadiusが推定できない場合は実行しない
     */
    ConstraintType["DENY_IF_SCOPE_UNCLEAR"] = "DENY_IF_SCOPE_UNCLEAR";
    /**
     * 曖昧度がしきい値を超えた場合はHLGへエスカレーション
     * AIの確信度が一定以下の場合、人間の判断を仰ぐ
     */
    ConstraintType["ESCALATE_IF_AMBIGUITY_GT"] = "ESCALATE_IF_AMBIGUITY_GT";
    /**
     * 特定の操作シグネチャを禁止
     * 完全に禁止された操作パターン
     */
    ConstraintType["DENY_OPERATION"] = "DENY_OPERATION";
    /**
     * リソース上限を設定
     * CPU、メモリ、ストレージ、コストなどの上限
     */
    ConstraintType["SET_RESOURCE_LIMIT"] = "SET_RESOURCE_LIMIT";
    /**
     * タイムアウトを設定
     * 承認待ち、実行、検証の時間制限
     */
    ConstraintType["SET_TIMEOUT"] = "SET_TIMEOUT";
    /**
     * 監査ログを強制
     * 特定の操作に対して詳細ログを記録
     */
    ConstraintType["ENFORCE_AUDIT_LOG"] = "ENFORCE_AUDIT_LOG";
    /**
     * 警告のみ（実行は許可）
     * 初回違反時の柔軟な対応
     */
    ConstraintType["WARN_ONLY"] = "WARN_ONLY";
})(ConstraintType || (exports.ConstraintType = ConstraintType = {}));
/**
 * フェーズ1: 決め打ち変換表 v1
 *
 * この表は運用開始の起点となります。
 * フェーズ4で統計データに基づいて自動的に更新・拡張されます。
 */
exports.REJECTION_TO_CONSTRAINT_MAP_V1 = [
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
var Repairability;
(function (Repairability) {
    /** 自動修復可能（パラメータ調整、リトライで解決） */
    Repairability["AUTO_REPAIRABLE"] = "AUTO_REPAIRABLE";
    /** 人間の介入で修復可能（承認、証拠提出など） */
    Repairability["HUMAN_REPAIRABLE"] = "HUMAN_REPAIRABLE";
    /** HLG（上位機関）の判断が必要 */
    Repairability["HLG_REQUIRED"] = "HLG_REQUIRED";
    /** 修復不可能（設計上の制約、システム限界） */
    Repairability["NOT_REPAIRABLE"] = "NOT_REPAIRABLE";
})(Repairability || (exports.Repairability = Repairability = {}));
/**
 * ICLの出力タイプ（型制約）
 * 自由回答ではなく、決められた選択肢のみ
 */
var ICLOutputType;
(function (ICLOutputType) {
    /** 状態遷移リクエスト（承認） */
    ICLOutputType["TRANSITION_REQUEST"] = "TRANSITION_REQUEST";
    /** 証拠の要求 */
    ICLOutputType["REQUEST_EVIDENCE"] = "REQUEST_EVIDENCE";
    /** HLGへのエスカレーション */
    ICLOutputType["ESCALATE_HLG"] = "ESCALATE_HLG";
    /** 拒否 */
    ICLOutputType["DENY"] = "DENY";
    /** 条件付き承認 */
    ICLOutputType["CONDITIONAL_APPROVAL"] = "CONDITIONAL_APPROVAL";
})(ICLOutputType || (exports.ICLOutputType = ICLOutputType = {}));
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
function generateConstraints(rejection_class, context) {
    const results = [];
    // 該当するルールをフィルタリング
    const applicable_rules = exports.REJECTION_TO_CONSTRAINT_MAP_V1.filter((rule) => {
        if (rule.from_rejection_class !== rejection_class)
            return false;
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
function recordRejectionTrace(trace, prev_hash) {
    return (0, proof_1.signEvent)({
        event_type: 'REJECTION_TRACE',
        trace,
    }, prev_hash, 'L1', 'ledger-icl');
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
function applyHardFilter(traces, criteria, current_request) {
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
