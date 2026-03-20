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

import { z } from 'zod';

/**
 * ProofV01 の必須フィールド（外形のみ）
 * v0.1: payload は unknown で許容
 */
export const ProofV01BaseSchema = z.object({
  version: z.literal('0.1'),
  event_id: z.string(),
  event_hash: z.string(),
  prev_hash: z.string().optional(),
  ts: z.string(), // ISO 8601
  actor: z.string(),
  layer: z.string(),
  event_type: z.string(),
  payload: z.unknown(), // v0.1: 任意の JSON
});

export type ProofV01Base = z.infer<typeof ProofV01BaseSchema>;

/**
 * Enrichment メタデータ（Hub/Council が計算）
 * v0.1: 最小セット
 */
export const EnrichmentSchema = z.object({
  // Fork Adoption
  fork_count: z.number().optional(),
  is_adopted: z.boolean().optional(),
  adopted_correction_id: z.string().optional(),
  effective_event_id: z.string().optional(),
  
  // Council
  node_id: z.string().optional(),
  node_seq: z.number().optional(),
  council_index: z.number().optional(),
}).passthrough(); // 拡張可能

export type Enrichment = z.infer<typeof EnrichmentSchema>;

/**
 * API Event (Proof + Enrichment)
 */
export const ApiEventSchema = ProofV01BaseSchema.extend({
  // Enrichment フィールドをフラット化
  fork_count: z.number().optional(),
  is_adopted: z.boolean().optional(),
  adopted_correction_id: z.string().optional(),
  effective_event_id: z.string().optional(),
  node_id: z.string().optional(),
  node_seq: z.number().optional(),
  council_index: z.number().optional(),
}).passthrough(); // 将来の拡張を許容

export type ApiEvent = z.infer<typeof ApiEventSchema>;

/**
 * GET /api/head
 * チェーンの HEAD 情報
 */
export const HeadResponseSchema = z.object({
  head_hash: z.string(),       // 最新イベントの event_hash
  head_ts: z.string(),         // 最新イベントの ts (ISO 8601)
  height: z.number(),          // チェーン長（イベント数）
  broken_links: z.number(),    // prev_hash 不整合の数（0 = 健全）
});

export type HeadResponse = z.infer<typeof HeadResponseSchema>;

/**
 * GET /api/events?since=<event_hash>&limit=<number>
 * カーソルベースのイベント取得
 */
export const EventsQuerySchema = z.object({
  since: z.string().optional(),    // カーソル（event_hash）。無ければ先頭から
  limit: z.coerce.number().min(1).max(1000).default(200), // 1-1000, default 200
});

export type EventsQuery = z.infer<typeof EventsQuerySchema>;

export const EventsPageResponseSchema = z.object({
  items: z.array(ApiEventSchema),   // enrichment 済みイベント
  next_since: z.string().nullable(), // 次のページ用カーソル（最後なら null）
  count: z.number(),                 // items の数
});

export type EventsPageResponse = z.infer<typeof EventsPageResponseSchema>;

/**
 * GET /api/council/state
 * Council の現在状態
 */
export const QuarantinedNodeSchema = z.object({
  node_id: z.string(),
  reason: z.string(),              // "prev_hash_mismatch" | "node_seq_gap" | "fetch_failed" | "invalid_proof" | "unknown"
  detail: z.string().optional(),   // エラー詳細
  since_ts: z.string(),            // 隔離開始時刻 (ISO 8601)
  last_ts: z.string().optional(),  // 最後に失敗した時刻 (ISO 8601)
  fail_count: z.number(),          // 失敗回数
  last_valid_seq: z.number(),      // 最後に有効だった node_seq
});

export type QuarantinedNode = z.infer<typeof QuarantinedNodeSchema>;

export const ForkSummarySchema = z.object({
  effective_event_id: z.string(),       // フォークターゲット
  fork_count: z.number(),               // 訂正候補の数
  adopted_correction_id: z.string(),    // 採用された訂正 ID
  candidates: z.array(z.string()),      // 全訂正候補 ID
});

export type ForkSummary = z.infer<typeof ForkSummarySchema>;

export const CouncilStateResponseSchema = z.object({
  adopted_correction_id: z.string().nullable(),  // 最新の採用訂正（無ければ null）
  forks: z.array(ForkSummarySchema),             // 全フォーク情報
  quarantined_nodes: z.array(QuarantinedNodeSchema), // 隔離ノード
  last_decision_ts: z.string().nullable(),       // 最後の採用決定時刻
});

export type CouncilStateResponse = z.infer<typeof CouncilStateResponseSchema>;

/**
 * Quarantine History Event
 */
export const QuarantineReasonSchema = z.enum([
  'prev_hash_mismatch',
  'event_hash_mismatch',
  'invalid_proof',
  'fetch_failed',
  'cooldown_retry',
  'recovered',
  'unknown',
]);

export const QuarantineActionSchema = z.enum(['QUARANTINE', 'RETRY', 'RECOVER']);

export const QuarantineEventSchema = z.object({
  type: z.literal('QUARANTINE_EVENT'),
  ts: z.string(),
  aggregator_id: z.string(),
  node_id: z.string(),
  action: QuarantineActionSchema,
  reason: QuarantineReasonSchema,
  fail_count: z.number().int().nonnegative(),
  detail: z.string().optional(),
  observed_head_hash: z.string().optional(),
  observed_height: z.number().int().optional(),
});

export type QuarantineEventT = z.infer<typeof QuarantineEventSchema>;

/**
 * GET /api/council/history
 */
export const CouncilHistoryQuerySchema = z.object({
  since: z.string().optional(),
  limit: z.coerce.number().min(1).max(500).default(200),
  node_id: z.string().optional(),
  action: QuarantineActionSchema.optional(),
});

export type CouncilHistoryQuery = z.infer<typeof CouncilHistoryQuerySchema>;

export const CouncilHistoryResponseSchema = z.object({
  items: z.array(QuarantineEventSchema),
  next_since: z.string().nullable(),
  count: z.number(),
});

export type CouncilHistoryResponse = z.infer<typeof CouncilHistoryResponseSchema>;

/**
 * Helper: Zod validation with error formatting
 */
export function validateRequest<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  } else {
    const errorMsg = result.error.issues
      .map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`)
      .join(', ');
    return { success: false, error: errorMsg };
  }
}
