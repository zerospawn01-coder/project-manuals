"use strict";
/**
 * contract/api_schema.ts
 *
 * Phase 5: Dashboard v0.1 - API Schema Definition
 *
 * 責務:
 * - HTTP API の request/response 型を Zod で固定
 * - Contract 主権: API の外形 = 法 = 主権
 * - payload は unknown（v0.1 では外形とチェーン整合のみ）
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CouncilHistoryResponseSchema = exports.CouncilHistoryQuerySchema = exports.QuarantineEventSchema = exports.QuarantineActionSchema = exports.QuarantineReasonSchema = exports.CouncilStateResponseSchema = exports.ForkSummarySchema = exports.QuarantinedNodeSchema = exports.EventsPageResponseSchema = exports.EventsQuerySchema = exports.HeadResponseSchema = exports.ApiEventSchema = exports.EnrichmentSchema = exports.ProofV01BaseSchema = void 0;
exports.validateRequest = validateRequest;
const zod_1 = require("zod");
/**
 * ProofV01 の必須フィールド（外形のみ）
 * v0.1: payload は unknown で許容
 */
exports.ProofV01BaseSchema = zod_1.z.object({
    version: zod_1.z.literal('0.1'),
    event_id: zod_1.z.string(),
    event_hash: zod_1.z.string(),
    prev_hash: zod_1.z.string().optional(),
    ts: zod_1.z.string(), // ISO 8601
    actor: zod_1.z.string(),
    layer: zod_1.z.string(),
    event_type: zod_1.z.string(),
    payload: zod_1.z.unknown(), // v0.1: 任意の JSON
});
/**
 * Enrichment メタデータ（Hub/Council が計算）
 * v0.1: 最小セット
 */
exports.EnrichmentSchema = zod_1.z.object({
    // Fork Adoption
    fork_count: zod_1.z.number().optional(),
    is_adopted: zod_1.z.boolean().optional(),
    adopted_correction_id: zod_1.z.string().optional(),
    effective_event_id: zod_1.z.string().optional(),
    // Council
    node_id: zod_1.z.string().optional(),
    node_seq: zod_1.z.number().optional(),
    council_index: zod_1.z.number().optional(),
}).passthrough(); // 拡張可能
/**
 * API Event (Proof + Enrichment)
 */
exports.ApiEventSchema = exports.ProofV01BaseSchema.extend({
    // Enrichment フィールドをフラット化
    fork_count: zod_1.z.number().optional(),
    is_adopted: zod_1.z.boolean().optional(),
    adopted_correction_id: zod_1.z.string().optional(),
    effective_event_id: zod_1.z.string().optional(),
    node_id: zod_1.z.string().optional(),
    node_seq: zod_1.z.number().optional(),
    council_index: zod_1.z.number().optional(),
}).passthrough(); // 将来の拡張を許容
/**
 * GET /api/head
 * チェーンの HEAD 情報
 */
exports.HeadResponseSchema = zod_1.z.object({
    head_hash: zod_1.z.string(), // 最新イベントの event_hash
    head_ts: zod_1.z.string(), // 最新イベントの ts (ISO 8601)
    height: zod_1.z.number(), // チェーン長（イベント数）
    broken_links: zod_1.z.number(), // prev_hash 不整合の数（0 = 健全）
});
/**
 * GET /api/events?since=<event_hash>&limit=<number>
 * カーソルベースのイベント取得
 */
exports.EventsQuerySchema = zod_1.z.object({
    since: zod_1.z.string().optional(), // カーソル（event_hash）。無ければ先頭から
    limit: zod_1.z.coerce.number().min(1).max(1000).default(200), // 1-1000, default 200
});
exports.EventsPageResponseSchema = zod_1.z.object({
    items: zod_1.z.array(exports.ApiEventSchema), // enrichment 済みイベント
    next_since: zod_1.z.string().nullable(), // 次のページ用カーソル（最後なら null）
    count: zod_1.z.number(), // items の数
});
/**
 * GET /api/council/state
 * Council の現在状態
 */
exports.QuarantinedNodeSchema = zod_1.z.object({
    node_id: zod_1.z.string(),
    reason: zod_1.z.string(), // "prev_hash_mismatch" | "node_seq_gap" | "fetch_failed" | "invalid_proof" | "unknown"
    detail: zod_1.z.string().optional(), // エラー詳細
    since_ts: zod_1.z.string(), // 隔離開始時刻 (ISO 8601)
    last_ts: zod_1.z.string().optional(), // 最後に失敗した時刻 (ISO 8601)
    fail_count: zod_1.z.number(), // 失敗回数
    last_valid_seq: zod_1.z.number(), // 最後に有効だった node_seq
});
exports.ForkSummarySchema = zod_1.z.object({
    effective_event_id: zod_1.z.string(), // フォークターゲット
    fork_count: zod_1.z.number(), // 訂正候補の数
    adopted_correction_id: zod_1.z.string(), // 採用された訂正 ID
    candidates: zod_1.z.array(zod_1.z.string()), // 全訂正候補 ID
});
exports.CouncilStateResponseSchema = zod_1.z.object({
    adopted_correction_id: zod_1.z.string().nullable(), // 最新の採用訂正（無ければ null）
    forks: zod_1.z.array(exports.ForkSummarySchema), // 全フォーク情報
    quarantined_nodes: zod_1.z.array(exports.QuarantinedNodeSchema), // 隔離ノード
    last_decision_ts: zod_1.z.string().nullable(), // 最後の採用決定時刻
});
/**
 * Quarantine History Event
 */
exports.QuarantineReasonSchema = zod_1.z.enum([
    'prev_hash_mismatch',
    'event_hash_mismatch',
    'invalid_proof',
    'fetch_failed',
    'cooldown_retry',
    'recovered',
    'unknown',
]);
exports.QuarantineActionSchema = zod_1.z.enum(['QUARANTINE', 'RETRY', 'RECOVER']);
exports.QuarantineEventSchema = zod_1.z.object({
    type: zod_1.z.literal('QUARANTINE_EVENT'),
    ts: zod_1.z.string(),
    aggregator_id: zod_1.z.string(),
    node_id: zod_1.z.string(),
    action: exports.QuarantineActionSchema,
    reason: exports.QuarantineReasonSchema,
    fail_count: zod_1.z.number().int().nonnegative(),
    detail: zod_1.z.string().optional(),
    observed_head_hash: zod_1.z.string().optional(),
    observed_height: zod_1.z.number().int().optional(),
});
/**
 * GET /api/council/history
 */
exports.CouncilHistoryQuerySchema = zod_1.z.object({
    since: zod_1.z.string().optional(),
    limit: zod_1.z.coerce.number().min(1).max(500).default(200),
    node_id: zod_1.z.string().optional(),
    action: exports.QuarantineActionSchema.optional(),
});
exports.CouncilHistoryResponseSchema = zod_1.z.object({
    items: zod_1.z.array(exports.QuarantineEventSchema),
    next_since: zod_1.z.string().nullable(),
    count: zod_1.z.number(),
});
/**
 * Helper: Zod validation with error formatting
 */
function validateRequest(schema, data) {
    const result = schema.safeParse(data);
    if (result.success) {
        return { success: true, data: result.data };
    }
    else {
        const errorMsg = result.error.issues
            .map((e) => `${e.path.join('.')}: ${e.message}`)
            .join(', ');
        return { success: false, error: errorMsg };
    }
}
