/**
 * tools/phase_a_llm_dispatcher.ts
 *
 * Phase A LLM Dispatcher — Gemini REST API Implementation
 * ========================================================
 *
 * 設計方針（3つの強制制約を完全実装）:
 *
 *   制約 1 — Structured Output（構造化出力）
 *     Gemini API の responseMimeType:"application/json" + responseSchema を使い、
 *     LLM に必ず PhaseACandidateList スキーマを満たす JSON を返させる。
 *     3層 acceptance_criteria (invariant_check / measurable_outcome / no_regression)
 *     はすべて required フィールドとして schema に定義する。
 *
 *   制約 2 — Negative Constraints Engine（失敗の憲法化）
 *     renderPhaseAPromptPair で生成したシステムプロンプトには
 *     {{NEGATIVE_CONSTRAINTS_BLOCK}} スロットが既に埋め込まれており、
 *     FailureLedger 由来の「二度とやってはいけないことリスト」が
 *     最優先レイヤーに注入されて渡ってくる。
 *     Dispatcher はそのプロンプトをそのまま systemInstruction として送信する。
 *
 *   制約 3 — Target Scope（カーネル保護）
 *     PHASE14_SYSTEM_TEMPLATE の冒頭に "KERNEL PROTECTION" 宣言を配置し、
 *     「OSカーネル・ガバナンスカーネル・Phase 14以外の層への変更提案禁止」を
 *     明文化する。LLM がカーネル層のファイルを affected_targets に含めた場合、
 *     後段の Phase B プリスクリーンで BLAST_RADIUS_EXCEEDED として棄却される。
 *
 * 使用方法:
 *   import { GeminiPhaseADispatcher, PHASE14_SYSTEM_TEMPLATE, PHASE14_USER_TEMPLATE }
 *     from './phase_a_llm_dispatcher';
 *
 *   const dispatcher = new GeminiPhaseADispatcher(process.env.GEMINI_API_KEY!);
 *
 *   const ctx: NightlyLoopContext = {
 *     phase_a_system_template: PHASE14_SYSTEM_TEMPLATE,
 *     phase_a_user_template:   PHASE14_USER_TEMPLATE,
 *     llm_dispatcher: dispatcher,
 *     ...
 *   };
 *
 * 環境変数:
 *   GEMINI_API_KEY — Gemini API キー（必須）
 *   GEMINI_MODEL   — 使用モデル（省略時: gemini-2.0-flash）
 */

import { randomUUID } from 'node:crypto';

import type { PhaseACandidateList, PatchCandidate } from '../contract/phase_a_prompt';
import type { PhaseALLMDispatcher } from './nightly_loop_runner';
import { validatePhaseAOutputShell } from './phase_a_orchestrator';

// ---------------------------------------------------------------------------
// Prompt Templates (スロット付き)
// renderSystemPrompt / renderUserPrompt が埋める {{SLOT}} を含む。
// ---------------------------------------------------------------------------

/**
 * Phase 14 システムプロンプトテンプレート
 *
 * 配置順序（最重要 → 補助）:
 *   1. KERNEL PROTECTION DECLARATION — カーネル保護宣言
 *   2. NEGATIVE CONSTRAINTS — FailureLedger 由来の禁止事項
 *   3. PROTECTED INVARIANTS — 破ってはならない不変条件
 *   4. MISSION — 具体的な任務定義
 *   5. OUTPUT CONTRACT — 出力スキーマ要件
 */
export const PHASE14_SYSTEM_TEMPLATE = `\
=== KERNEL PROTECTION DECLARATION (最優先制約・例外なし) ===
あなたはAntigravity OSのPhase 14 アプリケーション層改善エージェントである。
以下の制約は絶対的かつ上書き不可能である:

  1. 以下のファイル・ディレクトリへの変更提案を行ってはならない:
       - tools/                    (OSガバナンスカーネル)
       - contract/                 (型契約定義)
       - tests/                    (検証スイート)
       - fixtures/                 (テストデータ)
       - phase14/config/           (設定ファイル — 直接変更不可)
     　変更が必要な場合は affected_targets に含めず、
       title に "(config change required)" を付記して discarded_candidates に分類せよ。

  2. estimated_blast_radius を 'GLOBAL' に設定してはならない（TENANT以下のみ許可）。
     cross-module 変更が必要な場合は当該候補を discarded_candidates に移動せよ。

  3. negative_constraint_violations が空でない候補を candidates に含めてはならない。

=== NEGATIVE CONSTRAINTS (失敗の憲法 — 過去の失敗から導かれた禁止事項) ===
{{NEGATIVE_CONSTRAINTS_BLOCK}}

=== PROTECTED INVARIANTS (破壊禁止インバリアント) ===
{{PROTECTED_INVARIANTS_BLOCK}}

=== MISSION (任務定義) ===
あなたの任務は、Phase 14の「運用アプリケーション層」を対象とした
具体的・機械検証可能な改善パッチ候補を生成することである。

対象スコープ (改善提案の対象):
  - phase14/scripts/     — 週次ガバナンスレポートスクリプト群
  - phase14/src/phase14/ — ガバナンスロジック実装

評価基準: 現在のシステム安定度スコア = {{CURRENT_STABILITY_INDEX}}

=== OUTPUT CONTRACT (出力契約) ===
- 返却値は必ず PhaseACandidateList JSONスキーマに準拠すること。
- candidates は最大 {{MAX_CANDIDATES}} 件。
- 各候補は acceptance_criteria の3サブプルーフ（invariant_check /
  measurable_outcome / no_regression）を完備すること。
  いずれか一つが欠損していれば、その候補は Phase B で即時棄却される。
- measurable_outcome には stability_index_delta と最低1つの指標
  （saved_time_minutes_predicted / bugs_killed_predicted /
   refined_code_lines_predicted / tokens_saved_predicted）を含めること。
- patch_diff は unified diff (git diff -p) 形式で記述すること。
`;

/**
 * Phase 14 ユーザープロンプトテンプレート
 *
 * 観測データをすべて明示的に渡す。
 * LLMが「何を見て」提案したかが後から監査可能になる。
 */
export const PHASE14_USER_TEMPLATE = `\
=== 観測サイクル情報 ===
cycle_id: {{CYCLE_ID}}
assembled_at: {{ASSEMBLED_AT}}
previous_tier: {{PREVIOUS_TIER}}

=== インバリアント状態（現サイクル） ===
{{INVARIANT_RECENT_RESULTS_BLOCK}}

=== 失敗中リグレッションテスト ===
{{FAILING_REGRESSION_TESTS_BLOCK}}

=== ワークフロー実行時間ベースライン ===
{{WORKFLOW_BASELINES_BLOCK}}

=== アクティブ障害コード（FailureLedger） ===
{{ACTIVE_FAILURE_CODES_BLOCK}}

=== 改善ターゲット: FocusSeed（観測された痛点・優先度順） ===
{{FOCUS_SEEDS_BLOCK}}

=== ロールバック回復ターゲット（前サイクル ドリフト検出） ===
{{ACTIVE_ROLLBACK_BLOCK}}

=== 指示 ===
上記の FocusSeed を根拠として、phase14/scripts/ または phase14/src/phase14/ への
具体的・検証可能な改善パッチ候補を最大 {{MAX_CANDIDATES}} 件生成せよ。
各候補に acceptance_criteria の3サブプルーフを必ず付与すること。
`;

// ---------------------------------------------------------------------------
// JSON Schema — Gemini Structured Output 用
// Gemini の responseSchema は OpenAPI 3.0 サブセット (OBJECT/ARRAY/STRING/NUMBER/BOOLEAN)
// $ref / allOf / anyOf は未サポートのため flat に定義する。
// ---------------------------------------------------------------------------

const ACCEPTANCE_CRITERIA_SCHEMA = {
  type: 'OBJECT',
  properties: {
    invariant_check: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          invariant_id:        { type: 'STRING' },
          verdict:             { type: 'STRING', enum: ['pass', 'untouched'] },
          verification_method: { type: 'STRING' },
        },
        required: ['invariant_id', 'verdict'],
      },
    },
    measurable_outcome: {
      type: 'OBJECT',
      properties: {
        stability_index_delta:         { type: 'STRING', enum: ['neutral', 'positive'] },
        saved_time_minutes_predicted:   { type: 'NUMBER' },
        tokens_saved_predicted:         { type: 'NUMBER' },
        bugs_killed_predicted:          { type: 'NUMBER' },
        refined_code_lines_predicted:   { type: 'NUMBER' },
        measurement_basis:              { type: 'OBJECT' },
      },
      required: ['stability_index_delta', 'measurement_basis'],
    },
    no_regression: {
      type: 'OBJECT',
      properties: {
        regression_test_ids_verified_pass: { type: 'ARRAY', items: { type: 'STRING' } },
        invariant_ids_untouched:            { type: 'ARRAY', items: { type: 'STRING' } },
        orthogonality_rationale:            { type: 'STRING' },
      },
      required: ['regression_test_ids_verified_pass', 'invariant_ids_untouched'],
    },
  },
  required: ['invariant_check', 'measurable_outcome', 'no_regression'],
};

const PATCH_CANDIDATE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    candidate_id:     { type: 'STRING' },
    generated_at:     { type: 'STRING' },
    cycle_id:         { type: 'STRING' },
    title:            { type: 'STRING' },
    affected_targets: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          file_path:    { type: 'STRING' },
          function_name: { type: 'STRING' },
          change_type:  { type: 'STRING', enum: ['modify', 'delete', 'add'] },
        },
        required: ['file_path', 'change_type'],
      },
    },
    estimated_blast_radius:        { type: 'STRING', enum: ['SELF', 'TENANT', 'GLOBAL'] },
    patch_diff:                    { type: 'STRING' },
    acceptance_criteria:           ACCEPTANCE_CRITERIA_SCHEMA,
    negative_constraint_violations: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
  },
  required: [
    'candidate_id',
    'generated_at',
    'cycle_id',
    'title',
    'affected_targets',
    'estimated_blast_radius',
    'patch_diff',
    'acceptance_criteria',
    'negative_constraint_violations',
  ],
};

/** Gemini responseSchema for PhaseACandidateList */
export const CANDIDATE_LIST_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    schema_version:       { type: 'STRING' },
    cycle_id:             { type: 'STRING' },
    generated_at:         { type: 'STRING' },
    input_pack_id:        { type: 'STRING' },
    candidates:           { type: 'ARRAY', items: PATCH_CANDIDATE_SCHEMA },
    discarded_candidates: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          candidate_id:    { type: 'STRING' },
          title:           { type: 'STRING' },
          discard_reason:  { type: 'STRING' },
        },
        required: ['candidate_id', 'title', 'discard_reason'],
      },
    },
  },
  required: [
    'schema_version',
    'cycle_id',
    'generated_at',
    'input_pack_id',
    'candidates',
    'discarded_candidates',
  ],
};

// ---------------------------------------------------------------------------
// Gemini REST API helpers
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'gemini-2.5-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiGenerateRequest {
  contents: Array<{ role: string; parts: Array<{ text: string }> }>;
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig: {
    responseMimeType: string;
    responseSchema: object;
    temperature?: number;
    maxOutputTokens?: number;
    thinkingConfig?: { thinkingBudget: number };
  };
}

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: { code: number; message: string; status: string };
}

async function callGemini(
  api_key: string,
  model: string,
  req: GeminiGenerateRequest
): Promise<string> {
  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${api_key}`;
  // NOTE: url はキーを含むためエラーメッセージに含めない。
  const safe_endpoint = `${GEMINI_API_BASE}/${model}:generateContent?key=***`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
  } catch (network_err) {
    // fetch 自体の失敗（DNS解決失敗・接続拒否等）— URLをマスクして再スロー
    throw new Error(
      `Gemini API network error (${safe_endpoint}): ${(network_err as Error).message}`
    );
  }

  const body = await response.json() as GeminiGenerateResponse;

  if (!response.ok || body.error) {
    const msg = body.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`Gemini API error: ${msg}`);
  }

  const finish_reason = body.candidates?.[0]?.finishReason ?? 'unknown';
  if (finish_reason !== 'STOP' && finish_reason !== 'stop') {
    throw new Error(`Gemini stopped early (finishReason=${finish_reason}) — output may be truncated`);
  }

  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error(`Gemini returned empty content (finishReason=${finish_reason})`);
  }

  return text;
}

// ---------------------------------------------------------------------------
// Response post-processing
// ---------------------------------------------------------------------------

/**
 * Parse, enrich, and validate the raw JSON string from Gemini.
 *
 * Enrichment applied before returning:
 *   - candidate_id が空の場合は UUID を付与（Gemini が省略した場合の補完）
 *   - generated_at が空の場合は現在時刻を付与
 *   - cycle_id を呼び出し元の cycle_id で上書き（LLM が誤記した場合の保護）
 *   - schema_version を強制的に 'phase_a_output/0.1' に設定
 */
function parseAndValidateCandidateList(
  raw_text: string,
  cycle_id: string,
  input_pack_id: string
): PhaseACandidateList {
  let parsed: Record<string, unknown>;
  // Gemini 2.5 系はマークダウンコードブロックや BOM を混入させることがある
  let cleaned = raw_text.trim().replace(/^\uFEFF/, '');
  const md_match = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (md_match) cleaned = md_match[1];
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Gemini returned non-JSON content:\n${raw_text.slice(0, 500)}`
    );
  }

  const now = new Date().toISOString();

  // Enforce top-level fields
  parsed['schema_version'] = 'phase_a_output/0.1';
  parsed['cycle_id']       = cycle_id;
  parsed['generated_at']   = typeof parsed['generated_at'] === 'string' ? parsed['generated_at'] : now;
  parsed['input_pack_id']  = input_pack_id;

  if (!Array.isArray(parsed['candidates'])) parsed['candidates'] = [];
  if (!Array.isArray(parsed['discarded_candidates'])) parsed['discarded_candidates'] = [];

  // Enrich each candidate
  const candidates = parsed['candidates'] as Array<Record<string, unknown>>;
  for (const c of candidates) {
    if (!c['candidate_id'] || typeof c['candidate_id'] !== 'string') {
      c['candidate_id'] = randomUUID();
    }
    if (!c['generated_at'] || typeof c['generated_at'] !== 'string') {
      c['generated_at'] = now;
    }
    c['cycle_id'] = cycle_id;
    if (!Array.isArray(c['negative_constraint_violations'])) {
      c['negative_constraint_violations'] = [];
    }
    if (!Array.isArray(c['affected_targets'])) {
      c['affected_targets'] = [];
    }
  }

  // Shell validation
  const errors = validatePhaseAOutputShell(parsed);
  if (errors.length > 0) {
    throw new Error(
      `PhaseACandidateList schema validation failed:\n${errors.join('\n')}`
    );
  }

  return parsed as unknown as PhaseACandidateList;
}

// ---------------------------------------------------------------------------
// PUBLIC — GeminiPhaseADispatcher
// ---------------------------------------------------------------------------

export interface GeminiDispatcherOptions {
  /**
   * Gemini model ID.
   * Default: 'gemini-2.0-flash'
   * Structured output (responseSchema) requires:
   *   gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash, gemini-2.0-flash-lite
   */
  model?: string;
  /** Sampling temperature. Lower = more deterministic. Default: 0.2 */
  temperature?: number;
  /** Max output tokens. Default: 8192 */
  max_output_tokens?: number;
}

/**
 * PhaseALLMDispatcher implementation backed by Gemini REST API.
 *
 * Enforced guarantees:
 *   1. responseMimeType:"application/json" + responseSchema → structured output
 *   2. systemInstruction contains the rendered negative-constraints block
 *   3. PHASE14_SYSTEM_TEMPLATE limits scope to phase14/scripts/ + phase14/src/
 *
 * Constructor raises immediately if api_key is empty.
 */
export class GeminiPhaseADispatcher implements PhaseALLMDispatcher {
  private readonly api_key: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly max_output_tokens: number;

  constructor(api_key: string, options: GeminiDispatcherOptions = {}) {
    if (!api_key || !api_key.trim()) {
      throw new Error(
        'GeminiPhaseADispatcher: api_key is required. ' +
        'Set GEMINI_API_KEY environment variable.'
      );
    }
    this.api_key           = api_key;
    this.model             = options.model ?? (process.env['GEMINI_MODEL'] ?? DEFAULT_MODEL);
    this.temperature       = options.temperature ?? 0.2;
    this.max_output_tokens = options.max_output_tokens ?? 8192;
  }

  /**
   * Dispatch a Phase A LLM call.
   *
   * @param system_prompt  Fully rendered system prompt (all {{SLOT}} filled).
   * @param user_prompt    Fully rendered user prompt (all {{SLOT}} filled).
   * @param cycle_id       Current cycle ID — injected into response for audit.
   * @returns              Validated PhaseACandidateList.
   */
  async dispatch(
    system_prompt: string,
    user_prompt: string,
    cycle_id: string
  ): Promise<PhaseACandidateList> {
    const input_pack_id = randomUUID();

    const request: GeminiGenerateRequest = {
      contents: [
        { role: 'user', parts: [{ text: user_prompt }] },
      ],
      systemInstruction: {
        parts: [{ text: system_prompt }],
      },
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: CANDIDATE_LIST_RESPONSE_SCHEMA,
        temperature: this.temperature,
        maxOutputTokens: this.max_output_tokens,
        thinkingConfig: { thinkingBudget: 0 },
      },
    };

    const raw = await callGemini(this.api_key, this.model, request);
    return parseAndValidateCandidateList(raw, cycle_id, input_pack_id);
  }
}

// ---------------------------------------------------------------------------
// PUBLIC — createDispatcherFromEnv
// ---------------------------------------------------------------------------

/**
 * Construct a GeminiPhaseADispatcher from environment variables.
 *
 * Required env vars:
 *   GEMINI_API_KEY — Gemini API キー
 *
 * Optional env vars:
 *   GEMINI_MODEL   — モデルID (default: gemini-2.0-flash)
 *
 * @throws Error if GEMINI_API_KEY is not set.
 */
export function createDispatcherFromEnv(
  options?: GeminiDispatcherOptions
): GeminiPhaseADispatcher {
  const api_key = process.env['GEMINI_API_KEY'] ?? '';
  return new GeminiPhaseADispatcher(api_key, options);
}
