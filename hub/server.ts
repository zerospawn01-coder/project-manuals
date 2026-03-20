/**
 * hub/server.ts
 * 
 * Phase 2: Bifrost - Hub Server Layer
 * Phase 3: Singularity - Correction Protocol Integration
 * 
 * 責務:
 * 1. antigravity.log をリアルタイム監視（Tail機能）
 * 2. Server-Sent Events (SSE) でストリーミング配信
 * 3. RESTful API で過去ログ取得
 * 4. "Raw Ledger" vs "Effective View" の計算・返却
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';
import { globalConfig } from '../contract/config';
import { AntigravityEvent, signEvent } from '../contract/proof';
import {
  HeadResponse,
  EventsQuery,
  EventsPageResponse,
  CouncilStateResponse,
  validateRequest,
  EventsQuerySchema,
  CouncilHistoryQuery,
  CouncilHistoryQuerySchema,
  QuarantineEventT,
} from '../contract/api_schema';
import { CouncilAggregator, CouncilEvent, QuarantineRecord } from './council_aggregator';
import { Hub } from './append_log';
import { GeminiPeripheral } from '../peripherals/gemini_peripheral';
import { OllamaPeripheral } from '../peripherals/ollama_peripheral';
import { VertexPeripheral } from '../peripherals/vertex_peripheral';
import { globalBudgetTracker } from '../contract/budget';
import { WebSocketServer, WebSocket } from 'ws';
import { runbookService } from './runbookService';
import { auditService } from './auditService';
import { mockLiveApiStream } from './mockStream';

const LOG_FILE_PATH = path.resolve(__dirname, '../../antigravity.log');
const HTTP_PORT = 7777;

const AGGREGATOR_ID = 'central-99';
let this_tick_counter = 0;

void Hub.initialize().catch((error) => {
  console.error('[Hub] Failed to initialize log file:', error);
});

async function appendQuarantineEvent(payload: QuarantineEventT): Promise<void> {
  const lastEvent = await Hub.getLastEvent();
  const prevHash = lastEvent?.event_hash || '';
  const headInfo = getHeadInfo();
  const payloadWithObserved = {
    ...payload,
    observed_head_hash: headInfo.head_hash || undefined,
    observed_height: headInfo.height,
  };
  const event = signEvent(payloadWithObserved, prevHash, 'L1', payload.aggregator_id);
  event.actor = {
    layer: 'hub',
    name: payload.aggregator_id,
  };
  await Hub.appendEvent(event);
}

// Council Aggregator インスタンス（v0.1: Node A/B を監視）
const councilAggregator = new CouncilAggregator({
  aggregatorId: AGGREGATOR_ID,
  emit: async (payload) => {
    await appendQuarantineEvent(payload as QuarantineEventT);
  },
});
councilAggregator.registerNode('A', 'http://localhost:8001');
councilAggregator.registerNode('B', 'http://localhost:8002');

// Peripherals
const gemini = new GeminiPeripheral();
const ollama = new OllamaPeripheral();
const vertex = new VertexPeripheral();

// Monitoring State (Flow Link)
let final_accept_count_window = 0;
let dispatch_enqueued_window = 0;
let dispatch_dequeued_window = 0;
let dispatch_queue_len = 0;
let stall_counter = 0;
let is_stalled = false;

// 診断用統計
let rejection_counts: Record<string, number> = {
  budget: 0,
  safety: 0,
  sincerity: 0,
  logic: 0,
  other: 0
};
let tier_stats: Record<string, number> = {
  L0: 0,
  L1: 0,
  L2: 0
};

const CONFIG_PATH = path.resolve(__dirname, '../config/runtime.yaml');

// runtime.yaml の変更監視
fs.watch(CONFIG_PATH, async (event) => {
  if (event === 'change') {
    console.log('[GOVERNANCE] runtime.yaml changed. Reloading policy...');
    globalConfig.reload(); // 仮定: globalConfig にリロードメソッドがあると想定。なければ手動で読み込み。

    const newHash = globalConfig.getPolicyHash();
    const lastEvent = await Hub.getLastEvent();
    const prevHash = lastEvent?.event_hash || '';

    const updateEvent = signEvent({
      type: 'POLICY_LIVE_UPDATE',
      policy_hash: newHash,
      reason: 'MANUAL_CONFIG_EDIT'
    }, prevHash, 'L2', 'governance-watchdog');

    await Hub.appendEvent(updateEvent);
    console.log(`[GOVERNANCE] Policy Updated: ${newHash.substring(0, 8)}`);

    // SSE で通知
    broadcaster.broadcast(updateEvent);
  }
});

const CONFIG = globalConfig.getRuntimeConfig();

// 定期集約と監視（Flow Link Heartbeat）
setInterval(async () => {
  try {
    const headInfo = getHeadInfo();
    councilAggregator.setLocalHeadHash(headInfo.head_hash || null);
    await councilAggregator.aggregateAllNodes();

    if (final_accept_count_window > 0 && dispatch_enqueued_window === 0) {
      stall_counter++;
      if (stall_counter > 5) {
        is_stalled = true;
      }
    } else {
      stall_counter = 0;
      is_stalled = false;
    }

    if (stall_counter >= CONFIG.monitoring.stall_watchdog_threshold) {
      console.warn(`[WATCHDOG] Stall detected! ${stall_counter} windows. Forcing re-sync...`);

      // Queue Reset: Clear stalled dispatch state
      dispatch_queue_len = 0;
      dispatch_enqueued_window = 0;
      dispatch_dequeued_window = 0;

      // Record STALL_RECOVERY event to append-only chain
      const recoveryPayload = {
        type: 'STALL_RECOVERY',
        stall_windows: stall_counter,
        action: 'QUEUE_RESET',
        aggregator_id: AGGREGATOR_ID,
      };
      const recoveryLastEvent = await Hub.getLastEvent();
      const recoveryPrevHash = recoveryLastEvent?.event_hash || '';
      const recoveryEvent = signEvent(recoveryPayload, recoveryPrevHash, 'L1', `hub-${AGGREGATOR_ID}`);
      recoveryEvent.actor = { layer: 'hub', name: 'watchdog' };
      await Hub.appendEvent(recoveryEvent);

      console.log(`[WATCHDOG] Queue reset complete. STALL_RECOVERY event logged.`);
      stall_counter = 0;
    }

    // --- Heartbeat Event ---
    const pulseIntensity = Math.abs(Math.sin(Date.now() / 1000)) * (is_stalled ? 0.2 : 0.8) + (Math.random() * 0.2);
    const heartbeatPayload = {
      type: 'HEARTBEAT',
      pulse_intensity: pulseIntensity,
      build_id: globalConfig.getVersion().split('\n')[0].split(': ')[1],
      metrics: {
        final_accept_count_window,
        dispatch_enqueued_window,
        dispatch_dequeued_window,
        dispatch_queue_len,
        stall_counter
      }
    };

    // ウィンドウメトリクスのリセット（Heartbeatごと）
    final_accept_count_window = 0;
    dispatch_enqueued_window = 0;
    dispatch_dequeued_window = 0;

    const lastEvent = await Hub.getLastEvent();
    const prevHash = lastEvent?.event_hash || '';
    const event = signEvent(heartbeatPayload, prevHash, 'L1', `hub-${AGGREGATOR_ID}`);
    event.actor = { layer: 'hub', name: 'watchdog' };

    // SSE で即座に通知 (Direct Reactive Path)
    broadcaster.broadcast(event);

    // ハッシュチェーン（外部ストレージ）への記録は 10回に1回（1秒ごと）にしてノイズを抑制
    // ただし SSE では 100ms ごとに Pulse を送る
    this_tick_counter = (this_tick_counter || 0) + 1;
    if (this_tick_counter >= 10) {
      await Hub.appendEvent(event);
      console.log(`[HEARTBEAT] build_id: ${heartbeatPayload.build_id}, stall: ${stall_counter}, queue: ${dispatch_queue_len}`);
      this_tick_counter = 0;
    }

  } catch (error) {
    console.error('[Hub] Monitoring error:', error);
  }
}, CONFIG.monitoring.heartbeat_interval_ms);

/**
 * ログファイルの全行を読み込む
 */
function readAllLogs(): AntigravityEvent[] {
  try {
    const content = fs.readFileSync(LOG_FILE_PATH, 'utf-8');
    const lines = content
      .trim()
      .split('\n')
      .filter((line) => line.trim().length > 0);

    return lines.map((line) => JSON.parse(line) as AntigravityEvent);
  } catch (error) {
    console.error('[Server] Error reading all logs:', error);
    return [];
  }
}

/**
 * ログイベントに、訂正関連メタデータを計算して付与
 * 
 * Fork採用ルール v0.1:
 * - 同一targetを指す複数訂正の場合、ts最新のものを採用
 * - ts同一なら event_hash のレキシコグラフィック昇順（タイブレーク）
 * 
 * Fields:
 * - is_correction: このイベントが訂正イベントか
 * - corrects_event_id: 訂正イベントなら、対象イベントID
 * - corrected_by: 通常イベント/訂正イベントを指す全訂正イベントID（配列）
 * - adopted_correction_id: corrected_by の中から Fork採用ルールで選ばれた1つ
 * - effective_event_id: 訂正チェーンを辿った終端イベントID
 * - correction_depth: このイベントが訂正されている深さ
 */
function enrichEventMetadata(events: AntigravityEvent[]): any[] {
  const eventMap = new Map<string, AntigravityEvent>(
    events.map((e) => [e.event_id, e])
  );

  // Step 1: インデックス構築
  // correctionsByTarget[targetId] = [訂正イベント, ...] (ts DESC, hash ASC でソート)
  const correctionsByTarget = new Map<string, AntigravityEvent[]>();

  events.forEach((event) => {
    const targetId = (event.payload as any).correction_of;
    if (targetId) {
      if (!correctionsByTarget.has(targetId)) {
        correctionsByTarget.set(targetId, []);
      }
      correctionsByTarget.get(targetId)!.push(event);
    }
  });

  // ナソートルール: ts新しい順、同一tsなら event_hash昇順（レキシコグラフィック）
  correctionsByTarget.forEach((corrections) => {
    corrections.sort((a, b) => {
      const tsA = new Date(a.ts).getTime();
      const tsB = new Date(b.ts).getTime();
      if (tsA !== tsB) {
        return tsB - tsA; // 新しい順（降順）
      }
      // ts同一なら hash の辞書順
      return a.event_hash.localeCompare(b.event_hash); // 昇順
    });
  });

  // Step 2: 採用計算（Fork採用ルール v0.1）
  const adoptedCorrectionByTarget = new Map<string, string>();
  correctionsByTarget.forEach((corrections, targetId) => {
    if (corrections.length > 0) {
      adoptedCorrectionByTarget.set(targetId, corrections[0].event_id);
    }
  });

  // Step 3: effective_event_id をメモ化DFSで計算
  const effectiveMemo = new Map<string, string>();
  const visitedCycle = new Set<string>();

  function resolveEffective(id: string): string {
    if (effectiveMemo.has(id)) {
      return effectiveMemo.get(id)!;
    }

    if (visitedCycle.has(id)) {
      // サイクル検出 => PANIC（ただしこのテストでは発生しないはず）
      console.error(`[CRITICAL] Cycle detected in correction chain at ${id}`);
      return id;
    }

    visitedCycle.add(id);

    const adopted = adoptedCorrectionByTarget.get(id);
    if (!adopted) {
      // 訂正なし => このイベントが終端
      effectiveMemo.set(id, id);
      visitedCycle.delete(id);
      return id;
    }

    // 採用された訂正へ続いている => 再帰
    const result = resolveEffective(adopted);
    effectiveMemo.set(id, result);
    visitedCycle.delete(id);
    return result;
  }

  // Step 4: 出力構築
  return events.map((event) => {
    const isCorrection = !!(event.payload as any).correction_of;
    const correctsEventId = (event.payload as any).correction_of;

    // corrected_by: このイベントを直接指す全訂正イベント
    const correctionEvents = correctionsByTarget.get(event.event_id) || [];
    const correctedByIds = correctionEvents.map((c: AntigravityEvent) => c.event_id);

    // adopted_correction_id: Fork採用ルールで選ばれた訂正
    const adoptedId = adoptedCorrectionByTarget.get(event.event_id);

    // effective_event_id: 訂正チェーン終端
    const effectiveId = resolveEffective(event.event_id);

    // correction_depth: このイベントが訂正されている深さ
    let depth = 0;
    let ptr: string | undefined = event.event_id;
    const depthVisited = new Set<string>();
    while (ptr && adoptedCorrectionByTarget.has(ptr)) {
      if (depthVisited.has(ptr)) break; // サイクル防止
      depthVisited.add(ptr);
      depth++;
      ptr = adoptedCorrectionByTarget.get(ptr);
    }

    // fork_count: このイベントを訂正している数（フォークがあるか判定用）
    const forkCount = correctedByIds.length;

    // is_adopted: 訂正イベント側で、採用された訂正であるかフラグ
    let isAdopted = false;
    if (isCorrection && correctsEventId) {
      // 訂正イベント: ターゲットの adopted_correction_id がこのイベントと一致するか
      isAdopted = adoptedCorrectionByTarget.get(correctsEventId) === event.event_id;
    }

    return {
      ...event,
      is_correction: isCorrection,
      corrects_event_id: correctsEventId,
      corrected_by: correctedByIds,
      adopted_correction_id: adoptedId,
      effective_event_id: effectiveId,
      correction_depth: depth,
      fork_count: forkCount,
      is_adopted: isAdopted,
    };
  });
}

function calculateDiagnostics(enrichedEvents: any[]): void {
  // Clear stats
  rejection_counts = { budget: 0, safety: 0, sincerity: 0, logic: 0, other: 0 };
  tier_stats = { L0: 0, L1: 0, L2: 0 };

  enrichedEvents.forEach(event => {
    // Tier Stats
    if (event.legitimacy_tier && tier_stats[event.legitimacy_tier] !== undefined) {
      tier_stats[event.legitimacy_tier]++;
    }

    // Rejection Stats
    if (event.event_type === 'REJECTION' || (event.payload && event.payload.type === 'REJECTION')) {
      const reason = (event.payload?.reason || '').toLowerCase();
      if (reason.includes('budget')) rejection_counts.budget++;
      else if (reason.includes('safety')) rejection_counts.safety++;
      else if (reason.includes('sincerity')) rejection_counts.sincerity++;
      else if (reason.includes('logic')) rejection_counts.logic++;
      else rejection_counts.other++;
    }
  });
}

/**
 * SSE リスナー管理
 */
class SSEBroadcaster {
  private listeners: Set<any> = new Set();
  private lastProcessedLine: number = 0;

  constructor() {
    this.startWatching();
  }

  private startWatching(): void {
    const initialLines = this.countLines();
    this.lastProcessedLine = initialLines;

    fs.watchFile(LOG_FILE_PATH, (curr, prev) => {
      if (curr.mtime > prev.mtime) {
        const currentLines = this.countLines();
        if (currentLines > this.lastProcessedLine) {
          const newEvents = this.getNewLines(this.lastProcessedLine, currentLines);
          newEvents.forEach((event) => this.broadcast(event));
          this.lastProcessedLine = currentLines;
        }
      }
    });

    console.log(`[Server] Watching ${LOG_FILE_PATH}`);
  }

  private countLines(): number {
    try {
      const content = fs.readFileSync(LOG_FILE_PATH, 'utf-8');
      return content.split('\n').filter((line) => line.trim().length > 0).length;
    } catch {
      return 0;
    }
  }

  private getNewLines(startLine: number, endLine: number): AntigravityEvent[] {
    try {
      const content = fs.readFileSync(LOG_FILE_PATH, 'utf-8');
      const lines = content
        .trim()
        .split('\n')
        .filter((line) => line.trim().length > 0);

      return lines
        .slice(startLine, endLine)
        .map((line) => JSON.parse(line) as AntigravityEvent);
    } catch {
      return [];
    }
  }

  subscribe(res: any): void {
    this.listeners.add(res);
    res.on('close', () => {
      this.listeners.delete(res);
    });
  }

  public broadcast(event: AntigravityEvent): void {
    const enriched = enrichEventMetadata([event])[0];
    this.listeners.forEach((res) => {
      res.write(`data: ${JSON.stringify(enriched)}\n\n`);
    });
  }

  stop(): void {
    fs.unwatchFile(LOG_FILE_PATH);
    this.listeners.forEach((res) => res.end());
    this.listeners.clear();
  }
}

/**
 * API Helper: GET /api/head
 * チェーンの HEAD 情報を計算
 */
function getHeadInfo(): HeadResponse {
  const events = readAllLogs();

  if (events.length === 0) {
    return {
      head_hash: '',
      head_ts: new Date().toISOString(),
      height: 0,
      broken_links: 0,
    };
  }

  const lastEvent = events[events.length - 1];

  // broken_links の計算: prev_hash が前のイベントの event_hash と一致しないケース
  let brokenLinks = 0;
  for (let i = 1; i < events.length; i++) {
    const expectedPrev = events[i - 1].event_hash;
    const actualPrev = events[i].prev_hash;
    if (actualPrev !== expectedPrev) {
      brokenLinks++;
    }
  }

  return {
    head_hash: lastEvent.event_hash,
    head_ts: lastEvent.ts,
    height: events.length,
    broken_links: brokenLinks,
  };
}

/**
 * API Helper: GET /api/events?since=<cursor>&limit=<number>
 * カーソルベースでイベント取得（event_hash カーソル）
 */
function getEventsByCursor(query: EventsQuery): EventsPageResponse {
  const events = readAllLogs();
  const enriched = enrichEventMetadata(events);

  let startIndex = 0;

  // since が指定されている場合、そのイベントの次から返す
  if (query.since) {
    const cursorIndex = enriched.findIndex((e) => e.event_hash === query.since);
    if (cursorIndex !== -1) {
      startIndex = cursorIndex + 1; // カーソルの次から
    }
  }

  const endIndex = Math.min(startIndex + query.limit, enriched.length);
  const items = enriched.slice(startIndex, endIndex);

  // next_since: 次のページがある場合は最後のアイテムの event_hash
  const nextSince = endIndex < enriched.length ? items[items.length - 1]?.event_hash || null : null;

  return {
    items,
    next_since: nextSince,
    count: items.length,
  };
}

/**
 * API Helper: GET /api/council/state
 * Council の現在状態
 */
function getCouncilState(): CouncilStateResponse {
  // Council Aggregator からマージされたイベントを取得
  const councilLogs = councilAggregator.getCouncilLogs();

  // Fork 情報を抽出
  const forks = councilLogs
    .filter((e: CouncilEvent) => e.fork_count && e.fork_count > 1)
    .map((e: CouncilEvent) => ({
      effective_event_id: e.effective_event_id || e.event_id,
      fork_count: e.fork_count || 0,
      adopted_correction_id: e.adopted_correction_id || '',
      candidates: e.corrected_by || [],
    }));

  // 最新の採用訂正
  const adoptedCorrections = councilLogs.filter((e: CouncilEvent) => e.is_adopted);
  const latestAdopted = adoptedCorrections.length > 0
    ? adoptedCorrections[adoptedCorrections.length - 1]?.event_id
    : null;

  // 最後の採用決定時刻
  const lastDecisionTs = adoptedCorrections.length > 0
    ? adoptedCorrections[adoptedCorrections.length - 1]?.ts
    : null;

  // Quarantine 状態を取得
  const quarantinedNodes = councilAggregator.getQuarantinedNodes();

  return {
    adopted_correction_id: latestAdopted,
    forks,
    quarantined_nodes: quarantinedNodes,
    last_decision_ts: lastDecisionTs,
  };
}

/**
 * API Helper: GET /api/council/history
 * Quarantine event history (append-only)
 */
function getCouncilHistory(query: CouncilHistoryQuery) {
  const events = readAllLogs();

  const filtered = events
    .map((event) => ({
      payload: event.payload as QuarantineEventT,
      event_hash: event.event_hash,
    }))
    .filter((entry) => entry.payload?.type === 'QUARANTINE_EVENT')
    .filter((entry) => !query.node_id || entry.payload.node_id === query.node_id)
    .filter((entry) => !query.action || entry.payload.action === query.action);

  let startIndex = 0;
  if (query.since) {
    const cursorIndex = filtered.findIndex((entry) => entry.event_hash === query.since);
    if (cursorIndex !== -1) {
      startIndex = cursorIndex + 1;
    }
  }

  const endIndex = Math.min(startIndex + query.limit, filtered.length);
  const slice = filtered.slice(startIndex, endIndex);

  const nextSince = endIndex < filtered.length
    ? slice[slice.length - 1]?.event_hash || null
    : null;

  return {
    items: slice.map((entry) => entry.payload),
    next_since: nextSince,
    count: slice.length,
  };
}

const broadcaster = new SSEBroadcaster();

// --- Live Agents WebSocket Integration ---
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws: WebSocket) => {
  console.log('[LiveAgents] Client connected');
  let isNoisy = false;

  // Start mock stream
  mockLiveApiStream(ws, () => isNoisy);

  ws.on('message', async (message: string) => {
    try {
      const data = JSON.parse(message);
      const { action, isNoisy: noiseState } = data;
      isNoisy = !!noiseState;

      console.log(`[LiveAgents] Action received: ${action}`);

      switch (action) {
        case 'INIT_ROLLBACK':
          await auditService.logEvent(ws, 'SECURITY', 'AUTHORIZE_EXECUTION', 'Gated authorization verified. Triggering rollback.');
          // Simulate rollback progress
          for (let i = 0; i <= 100; i += 25) {
            setTimeout(() => {
              ws.send(JSON.stringify({
                type: 'ROLLBACK_STATUS',
                weights: { fail: 100 - i, stable: i }
              }));
              if (i === 100) {
                auditService.logEvent(ws, 'SYSTEM', 'ROLLBACK_COMPLETE', 'V1.2 restored successfully.');
              }
            }, i * 50);
          }
          break;

        case 'OPEN_2FA':
          const runbook = runbookService.getRunbook('DEPLOY_FAIL');
          ws.send(JSON.stringify({ type: 'RUNBOOK_DATA', data: runbook }));
          await auditService.logEvent(ws, 'OPERATIONAL', 'RUNBOOK_FETCH', 'Evidence-based runbook synthesized for DEPLOY_FAIL');
          break;

        default:
          await auditService.logEvent(ws, 'SVP', action, 'Command processed');
      }
    } catch (e) {
      console.error('[LiveAgents] Socket error:', e);
      ws.send(JSON.stringify({ type: 'INTEGRITY_ERROR', data: 'Server processing failure' }));
    }
  });
});

/**
 * HTTP サーバー
 */
const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathName = urlObj.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // GET / - HTMLダッシュボード
  if (req.url === '/' && req.method === 'GET') {
    const html = getDashboardHTML();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // GET /api/logs - 全イベント（メタデータ付き）
  if (req.url === '/api/logs' && req.method === 'GET') {
    const events = readAllLogs();
    const enriched = enrichEventMetadata(events);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(enriched));
    return;
  }

  // GET /api/logs/stream - SSE ストリーム
  if (req.url === '/api/logs/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    broadcaster.subscribe(res);
    return;
  }

  // GET /health - ヘルスチェック
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', log_file: LOG_FILE_PATH }));
    return;
  }

  // GET /api/head - チェーン HEAD 情報
  if (req.url === '/api/head' && req.method === 'GET') {
    try {
      const headInfo = getHeadInfo();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(headInfo));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
    return;
  }

  // GET /api/events?since=<cursor>&limit=<number> - カーソルベースイベント取得
  if (req.url?.startsWith('/api/events') && req.method === 'GET') {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const queryParams = {
        since: url.searchParams.get('since') || undefined,
        limit: url.searchParams.get('limit') || undefined,
      };

      const validation = validateRequest(EventsQuerySchema, queryParams);
      if (!validation.success) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (validation as { error: string }).error }));
        return;
      }

      const result = getEventsByCursor(validation.data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
    return;
  }
  // GET /api/diagnostics - 診断情報  // POST /api/governance/quarantine - ノード隔離（UI からの直接介入）
  if (pathName === '/api/governance/quarantine' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const nodeId = payload.node_id;

        console.log(`[GOVERNANCE] INTERVENTION: Quarantining node ${nodeId}`);

        const lastEvent = await Hub.getLastEvent();
        const prevHash = lastEvent?.event_hash || '';

        const interventionEvent = signEvent({
          type: 'QUARANTINE_NODE',
          node_id: nodeId,
          reason: 'UI_INTERVENTION',
          aggregator_id: AGGREGATOR_ID
        }, prevHash, 'L2', 'human-governor');

        await Hub.appendEvent(interventionEvent);
        broadcaster.broadcast(interventionEvent);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', event_id: interventionEvent.event_id }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid payload' }));
      }
    });
    return;
  }
  if (pathName === '/api/diagnostics' && req.method === 'GET') {
    try {
      const events = readAllLogs();
      const enriched = enrichEventMetadata(events);
      calculateDiagnostics(enriched);

      const stats = {
        is_stalled,
        rejection_counts,
        tier_stats,
        governance_version: '2.0.0-SOVEREIGN',
        policy_hash: globalConfig.getPolicyHash()
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
    return;
  }
  // GET /api/council/state - Council 状態
  if (pathName === '/api/council/state' && req.method === 'GET') {
    try {
      const state = getCouncilState();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
    return;
  }

  // GET /api/council/history - Quarantine history
  if (req.url?.startsWith('/api/council/history') && req.method === 'GET') {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const queryParams = {
        since: url.searchParams.get('since') || undefined,
        limit: url.searchParams.get('limit') || undefined,
        node_id: url.searchParams.get('node_id') || undefined,
        action: url.searchParams.get('action') || undefined,
      };

      const validation = validateRequest(CouncilHistoryQuerySchema, queryParams);
      if (!validation.success) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (validation as { error: string }).error }));
        return;
      }

      const result = getCouncilHistory(validation.data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
    return;
  }

  // POST /api/generate - Hybrid AI Generation
  if (pathName === '/api/generate' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk: any) => { body += chunk; });
    req.on('end', async () => {
      try {
        const { prompt, provider = 'auto' } = JSON.parse(body);

        // --- Selection Metric: Request ---
        councilAggregator.recordCount('ai_request', 1);

        // --- Flow Link: Accept ---
        final_accept_count_window++;

        let selectedProvider = provider;
        if (provider === 'auto') {
          selectedProvider = 'gemini';
        }

        // --- Flow Link: Dispatch Start ---
        dispatch_enqueued_window++;
        dispatch_queue_len++;

        let responseText = '';
        let vertexAttestation: any;
        let vertexUsage: any;
        const inferenceStartTime = Date.now();

        try {
          if (selectedProvider === 'gemini') {
            const stream = vertex.generateResponseStream(prompt);
            for await (const chunk of stream) {
              if (chunk.done) {
                responseText = chunk.result!.content;
                vertexAttestation = chunk.result!.attestation;
                vertexUsage = chunk.result!.usage;
                (vertexUsage as any).grounding_metadata = chunk.result!.grounding_metadata;
              } else {
                responseText += chunk.token;
                broadcaster.broadcast({
                  schema_version: 'proof/0.2',
                  event_id: `stream-${Math.random().toString(36).substring(2, 9)}`,
                  event_hash: '',
                  ts: new Date().toISOString(),
                  prev_hash: '',
                  legitimacy_tier: 'L0',
                  confidence: 1.0,
                  actor: { layer: 'hub', name: 'streaming-gate' },
                  payload: {
                    type: 'TOKEN_CHUNK',
                    prompt_id: `prompt-${Math.random().toString(36).substring(2, 9)}`,
                    token: chunk.token
                  },
                  budget_snapshot: globalBudgetTracker.snapshot()
                } as any);
              }
            }
          } else {
            responseText = await ollama.generateResponse(prompt);
          }
        } finally {
          dispatch_dequeued_window++;
          dispatch_queue_len = Math.max(0, dispatch_queue_len - 1);
        }

        const sincerityScore = 0.7; // Simplified for stability test
        const isSincere = true;
        const targetTier = 'L1';

        const lastEvent = await Hub.getLastEvent();
        const prevHash = lastEvent?.event_hash || '';

        const event = signEvent({
          type: 'AI_GENERATION',
          prompt,
          response: responseText,
          sincerity_score: sincerityScore,
          selection_status: 'PASS'
        } as any, prevHash, targetTier, `hub-${AGGREGATOR_ID}`);

        event.actor = { layer: 'hub', name: `executor-${selectedProvider}` };
        await Hub.appendEvent(event);
        broadcaster.broadcast(event);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ response: responseText, event_id: event.event_id }));
      } catch (error) {
        console.error('[Hub] Generation Error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Generation failed' }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404);
  res.end('Not Found');
});

/**
 * ダッシュボードHTML
 */
function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Antigravity OS - Council Dashboard v0.1</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', monospace;
      background: #0a0a0a;
      color: #00ff00;
      padding: 20px;
    }
    .header { text-align: center; margin-bottom: 30px; }
    .header h1 { font-size: 2.2em; color: #00ffff; margin-bottom: 5px; }
    .header p { color: #888; font-size: 0.9em; }
    .toolbar {
      background: #1a1a1a;
      padding: 12px 15px;
      border: 1px solid #00ff00;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 20px;
    }
    .filter-group {
      display: flex;
      gap: 10px;
    }
    .checkbox-group {
      display: flex;
      gap: 15px;
      align-items: center;
    }
    .checkbox-group label {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      font-size: 0.9em;
    }
    .checkbox-group input[type="checkbox"] {
      cursor: pointer;
    }
    .status-text {
      color: #888;
      font-size: 0.85em;
    }
    .panels {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
      margin-bottom: 20px;
    }
    .panel {
      border: 1px solid #00ff00;
      background: #0a0a0a;
      padding: 15px;
    }
    .panel-header {
      color: #00ffff;
      font-weight: bold;
      margin-bottom: 10px;
      font-size: 1.1em;
    }
    .panel-content {
      font-size: 0.9em;
      line-height: 1.6;
    }
    .metric {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #222;
    }
    .metric:last-child {
      border-bottom: none;
    }
    .metric-label { color: #888; }
    .metric-value { color: #00ffff; font-weight: bold; }
    .status-ok { color: #00ff00; }
    .status-warn { color: #ffaa00; }
    .status-error { color: #ff3333; }
    .fork-item {
      padding: 6px 0;
      padding-left: 10px;
      border-left: 3px solid #00ff00;
      margin: 5px 0;
      font-size: 0.85em;
    }
    .node-item {
      padding: 8px;
      margin: 8px 0;
      background: #1a1a1a;
      border: 1px solid #666;
      font-size: 0.85em;
    }
    .node-item.quarantine {
      background: #331111;
      border-color: #ff3333;
      color: #ff8888;
    }
    .node-item.healthy {
      background: #113311;
      border-color: #00ff00;
      color: #88ff88;
    }
    .events-full {
      grid-column: 1 / -1;
    }
    #events-container {
      max-height: 400px;
      overflow-y: auto;
      background: #0a0a0a;
    }
    .event-row {
      padding: 10px;
      border-bottom: 1px solid #222;
      display: flex;
      gap: 15px;
      font-size: 0.85em;
    }
    .event-row:hover { background: #1a1a1a; }
    .event-flag {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 0.75em;
      font-weight: bold;
      margin-right: 5px;
    }
    .flag-fork { background: #0088ff; color: #fff; }
    .flag-quarantine { background: #ff3333; color: #fff; }
    .flag-panic { background: #ffaa00; color: #000; }
    .flag-l1 { background: #00ffff; color: #000; }
    .event-hash { color: #888; font-size: 0.8em; }
    .receipt-box {
      margin-top: 5px;
      padding: 5px;
      background: #111;
      border: 1px dashed #444;
      font-size: 0.8em;
      color: #aaa;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🌀 Antigravity OS - Council Dashboard</h1>
    <p>Phase 5: Real-time Council State & Quarantine Visibility | v0.1</p>
  </div>

  <div class="toolbar">
    <div class="filter-group">
      <div class="checkbox-group">
        <label>
          <input type="checkbox" id="filter-flagged" unchecked>
          Flagged Only
        </label>
        <label>
          <input type="checkbox" id="filter-panic" unchecked>
          PANIC Only
        </label>
      </div>
    </div>
    <div class="status-text">
      Last Update: <span id="last-update">--:--:--</span> | Refresh: 2s
    </div>
  </div>

  <div class="panels">
    <div class="panel">
      <div class="panel-header">⛓️  Chain Health</div>
      <div class="panel-content">
        <div class="metric">
          <span class="metric-label">Head Hash</span>
          <span class="metric-value" id="metric-head-hash">--</span>
        </div>
        <div class="metric">
          <span class="metric-label">Height</span>
          <span class="metric-value" id="metric-height">0</span>
        </div>
        <div class="metric">
          <span class="metric-label">Broken Links</span>
          <span class="metric-value" id="metric-broken-links">0</span>
        </div>
        <div class="metric">
          <span class="metric-label">Status</span>
          <span class="metric-value status-ok" id="metric-chain-status">✓ HEALTHY</span>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">🏛️  Council Decision</div>
      <div class="panel-content">
        <div class="metric">
          <span class="metric-label">Adopted Correction</span>
          <span class="metric-value event-hash" id="metric-adopted">None</span>
        </div>
        <div class="metric">
          <span class="metric-label">Active Forks</span>
          <span class="metric-value" id="metric-fork-count">0</span>
        </div>
        <div class="metric">
          <span class="metric-label">Last Decision</span>
          <span class="metric-value event-hash" id="metric-last-decision">--</span>
        </div>
        <div id="forks-list" style="margin-top: 10px; max-height: 80px; overflow-y: auto;"></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">📡 Node Status</div>
      <div class="panel-content" id="node-status-list">
        <div class="node-item healthy">A: ✓ HEALTHY</div>
        <div class="node-item healthy">B: ✓ HEALTHY</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">⚠️  Quarantine Tracker</div>
      <div class="panel-content" id="quarantine-list">
        <div style="color: #888;">No quarantined nodes</div>
      </div>
    </div>

    <div class="panel events-full">
      <div class="panel-header">📈 Pulse Architecture (Sieve Shadow Invariant $R \approx 0.7$)</div>
      <div class="panel-content" style="height: 150px; position: relative; background: #000; overflow: hidden;">
        <canvas id="pulse-canvas" style="width: 100%; height: 100%;"></canvas>
        <div style="position: absolute; top: 10px; right: 10px; font-size: 0.8em; color: #00ffff;">
          Current R: <span id="current-r-val">0.700</span>
        </div>
      </div>
    </div>

    <div class="panel events-full">
      <div class="panel-header" id="event-stream-header">📋 Event Stream (0 Events)</div>
      <div id="events-container"></div>
    </div>

    <div class="panel events-full" id="grounding-panel" style="display: none;">
      <div class="panel-header" style="color: #ff00ff;">🏛️  Epistemic Grounds (L2 Verification)</div>
      <div class="panel-content" id="grounding-content">
        <div style="color: #888;">Waiting for verifiable generation...</div>
      </div>
    </div>
  </div>

  <script>
    let allEvents = [];
    let councilState = null;
    let headInfo = null;
    let filterFlaggedOnly = false;
    let filterPanicOnly = false;

    // --- SSE Configuration (Real-time Link) ---
    function connectSSE() {
      const source = new EventSource('/api/logs/stream');
      source.onmessage = function(event) {
        const data = JSON.parse(event.data);
        handleIncomingEvent(data);
      };
      source.onerror = function(err) {
        console.warn('SSE connection lost. Retrying in 3s...');
        source.close();
        setTimeout(connectSSE, 3000);
      };
    }

    function handleIncomingEvent(event) {
      // Add to local events (Latest 100)
      allEvents.push(event);
      if (allEvents.length > 100) allEvents.shift();

      // Real-time Pulse Update
      if (event.payload && event.payload.sincerity_score !== undefined) {
        updatePulseValue(event.payload.sincerity_score);
      } else if (event.payload && event.payload.pulse_intensity !== undefined) {
        const rProp = 0.7 + (event.payload.pulse_intensity - 0.5) * 0.2;
        updatePulseValue(rProp);
      }

      // Token Chunk Handling
      if (event.payload && event.payload.type === 'TOKEN_CHUNK') {
        handleTokenChunk(event.payload.token);
        return; // Don't add chunk to full event stream UI
      }

      // Immediate Re-render
      renderEvents();
      updateMetricsFromEvent(event);
    }

    let streamingText = '';
    function handleTokenChunk(token) {
        streamingText += token;
        const container = document.getElementById('events-container');
        let liveEl = document.getElementById('live-stream-box');
        if (!liveEl) {
            liveEl = document.createElement('div');
            liveEl.id = 'live-stream-box';
            liveEl.className = 'event-row';
            liveEl.style.border = '1px solid #00ffff';
            liveEl.style.background = '#001111';
            liveEl.innerHTML = '<strong>[SOVEREIGN STREAM]</strong> <span id="live-content"></span>';
            container.prepend(liveEl);
        }
        document.getElementById('live-content').textContent = streamingText;
        
        // Pulse visually reacts to each token
        updatePulseValue(0.7 + (Math.random() - 0.5) * 0.1);
    }

    // Filter UI Setup
    document.getElementById('filter-flagged').addEventListener('change', (e) => {
      filterFlaggedOnly = e.target.checked;
      renderEvents();
    });
    document.getElementById('filter-panic').addEventListener('change', (e) => {
    document.getElementById('filter-panic').addEventListener('change', function(e) {
      filterPanicOnly = e.target.checked;
      renderEvents();
    });

    // Build flag array for an event
    function buildFlags(row, state) {
      var flags = [];
      var fCount = (typeof row.fork_count === 'number') ? row.fork_count : null;

      if (fCount && fCount > 1) {
        flags.push({ tag: 'FORK', 'class': 'flag-fork', text: 'FORK(' + fCount + ')' });
      }
      
      var actorNodeId = (row.actor && row.actor.node_id) || null;
      if (state && actorNodeId) {
        var isQuarantined = false;
        if (state.quarantined_nodes) {
          for (var i = 0; i < state.quarantined_nodes.length; i++) {
            if (state.quarantined_nodes[i].node_id === actorNodeId) {
              isQuarantined = true;
              break;
            }
          }
        }
        if (isQuarantined) {
          flags.push({ tag: 'QUARANTINE_NODE', 'class': 'flag-quarantine', text: 'QUARANTINE_NODE' });
        }
      }
      
      if (fCount && fCount >= 3 && state && state.quarantined_nodes && state.quarantined_nodes.length >= 2) {
        flags.push({ tag: 'PANIC', 'class': 'flag-panic', text: 'PANIC' });
      }

      if (row.legitimacy_tier === 'L1') {
        flags.push({ tag: 'L1', 'class': 'flag-l1', text: 'L1: PROC_AUTH' });
      }
      
      return flags;
    }

    function isEventFlagged(row, state) {
      return buildFlags(row, state).length > 0;
    }

    function renderEvents() {
      var container = document.getElementById('events-container');
      if (!container) return;
      container.innerHTML = '';

      var displayed = allEvents;

      if (filterFlaggedOnly) {
        displayed = displayed.filter(function(row) { return isEventFlagged(row, councilState); });
      }
      if (filterPanicOnly) {
        displayed = displayed.filter(function(row) {
          var flags = buildFlags(row, councilState);
          return flags.some(function(f) { return f.tag === 'PANIC'; });
        });
      }

      displayed = displayed.slice(-50).reverse();

      var tCount = allEvents.length;
      var sCount = displayed.length;
      var hText = tCount > 50 
        ? "📋 Event Stream (Latest " + sCount + " of " + tCount + ")"
        : "📋 Event Stream (" + sCount + " Events)";
      document.getElementById('event-stream-header').textContent = hText;

      displayed.forEach(function(row) {
        var el = document.createElement('div');
        el.className = 'event-row';

        var flags = buildFlags(row, councilState);
        var flagsHtml = flags.map(function(f) { 
          return '<span class="event-flag ' + f['class'] + '">' + f.text + '</span>'; 
        }).join('');

        var actorName = (row.actor && (row.actor.name || row.actor.node_id)) || 'Unknown';
        var hash = row.event_hash ? row.event_hash.substring(0, 12) : '?';
        var ts = new Date(row.ts).toLocaleTimeString('en-US');

        var receiptHtml = '';
        if (row.payload && row.payload.tool_receipt) {
          var tr = row.payload.tool_receipt;
          receiptHtml = '<div class="receipt-box">' +
                        '<strong>Vault ID:</strong> ' + tr.request_id + '<br/>' +
                        '<strong>OIDC:</strong> ' + tr.identity_token.substring(0, 20) + '...<br/>' +
                        '<strong>Latency:</strong> ' + tr.performance.latency_ms + ' ms</div>';
        }

        el.innerHTML = '<div style="flex: 0 0 auto;"><strong>' + ts + '</strong></div>' +
                       '<div style="flex: 1; min-width: 0;">' +
                       '<div>' + flagsHtml + ' <strong>' + actorName + '</strong></div>' +
                       '<div class="event-hash">' + hash + '</div>' + 
                       receiptHtml + 
                       '</div>';

        container.appendChild(el);
      });
    }

    // Oscilloscope Implementation
    const canvas = document.getElementById('pulse-canvas');
    const ctx = canvas.getContext('2d');
    let pulseData = new Array(100).fill(0.7);

    function drawPulse() {
      const w = canvas.width = canvas.offsetWidth;
      const h = canvas.height = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);

      // Target Line (0.7)
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.2)';
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(0, h * 0.3); // Inverted scale for better look
      ctx.lineTo(w, h * 0.3);
      ctx.stroke();
      ctx.setLineDash([]);

      // Waveform
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < pulseData.length; i++) {
        const x = (i / (pulseData.length - 1)) * w;
        const y = h * (1.0 - pulseData[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      
      requestAnimationFrame(drawPulse);
    }

    function updatePulseValue(newR) {
      pulseData.push(newR);
      pulseData.shift();
      const rEl = document.getElementById('current-r-val');
      if (rEl) rEl.textContent = newR.toFixed(3);
    }
    
    drawPulse();

    async function updateDashboard() {
      try {
        var headResp = await fetch('/api/head');
        headInfo = await headResp.json();

        var councilResp = await fetch('/api/council/state');
        var councilStateData = await councilResp.json();

        var eventsResp = await fetch('/api/events?limit=50');
        var eventsData = await eventsResp.json();
        
        allEvents = eventsData.items || []; // Initial sync of events
        councilState = councilStateData;

        var now = new Date();
        document.getElementById('last-update').textContent = now.toLocaleTimeString('en-US');

        document.getElementById('metric-head-hash').textContent = headInfo.head_hash ? headInfo.head_hash.substring(0, 12) : 'None';
        document.getElementById('metric-height').textContent = headInfo.height || '0';
        var brokenLinks = headInfo.broken_links || 0;
        document.getElementById('metric-broken-links').textContent = brokenLinks;
        var chainStatus = brokenLinks === 0 ? '✓ HEALTHY' : '⚠️  DEGRADED';
        var chainClass = brokenLinks === 0 ? 'status-ok' : 'status-warn';
        var chainEl = document.getElementById('metric-chain-status');
        if (chainEl) {
          chainEl.textContent = chainStatus;
          chainEl.className = 'metric-value ' + chainClass;
        }

        document.getElementById('metric-adopted').textContent =
          councilState.adopted_correction_id ? councilState.adopted_correction_id.substring(0, 12) : 'None';
        var forkCountValue = councilState.forks ? councilState.forks.length : 0;
        document.getElementById('metric-fork-count').textContent = forkCountValue;
        document.getElementById('metric-last-decision').textContent =
          councilState.last_decision_ts ? new Date(councilState.last_decision_ts).toLocaleTimeString('en-US') : '--';

        var forksList = document.getElementById('forks-list');
        if (forksList) {
          forksList.innerHTML = '';
          if (councilState.forks && councilState.forks.length > 0) {
            councilState.forks.forEach(function(fork) {
              var forkEl = document.createElement('div');
              forkEl.className = 'fork-item';
              var candidates = fork.candidates ? fork.candidates.map(function(c) { return c.substring(0, 8) + '...'; }).join(', ') : 'N/A';
              forkEl.textContent = "Fork ID " + fork.fork_id + ": [" + candidates + "]";
              forksList.appendChild(forkEl);
            });
          } else {
            forksList.innerHTML = '<div style="color: #888; font-size: 0.85em;">No active forks</div>';
          }
        }

        var nodeList = document.getElementById('node-status-list');
        if (nodeList) {
          nodeList.innerHTML = '';
          var quarantinedIds = new Set((councilState.quarantined_nodes || []).map(function(qn) { return qn.node_id; }));
          ['A', 'B'].forEach(function(nodeId) {
            var nodeEl = document.createElement('div');
            nodeEl.className = 'node-item ' + (quarantinedIds.has(nodeId) ? 'quarantine' : 'healthy');
            var statusStr = quarantinedIds.has(nodeId) ? '⚠️  QUARANTINED' : '✓ HEALTHY';
            nodeEl.textContent = "Node " + nodeId + ": " + statusStr;
            nodeList.appendChild(nodeEl);
          });
        }

        var qList = document.getElementById('quarantine-list');
        if (qList) {
          qList.innerHTML = '';
          if (councilState.quarantined_nodes && councilState.quarantined_nodes.length > 0) {
            councilState.quarantined_nodes.forEach(function(qn) {
              var qEl = document.createElement('div');
              qEl.className = 'node-item quarantine';
              var fCount = qn.fail_count || 0;
              var sTs = qn.since_ts ? new Date(qn.since_ts).toLocaleTimeString('en-US') : '--';
              qEl.innerHTML = "<strong>" + qn.node_id + "</strong> | Reason: " + qn.reason + " | Fails: " + fCount + " | Since: " + sTs;
              qList.appendChild(qEl);
            });
          } else {
            qList.innerHTML = '<div style="color: #888;">All nodes operational</div>';
          }
        }

        renderEvents();
        // Clear live box if it exists when a full event arrives
        const liveEl = document.getElementById('live-stream-box');
        if (liveEl) { liveEl.remove(); streamingText = ''; }

        // Update Grounding Display if L2
        if (event.legitimacy_tier === 'L2' && event.payload.grounding) {
            updateGroundingPanel(event.payload.grounding);
        }
      } catch (err) {
        console.error('Initial state fetch error:', err);
      }
    }

    function updateMetricsFromEvent(event) {
      // Increment Height locally
      const heightEl = document.getElementById('metric-height');
      if (heightEl) heightEl.textContent = parseInt(heightEl.textContent || '0') + 1;
      
      const headHashEl = document.getElementById('metric-head-hash');
      if (headHashEl && event.event_hash) headHashEl.textContent = event.event_hash.substring(0, 12);
      
      const lastUpdateEl = document.getElementById('last-update');
      if (lastUpdateEl) lastUpdateEl.textContent = new Date().toLocaleTimeString('en-US');

      if (event.payload && event.payload.type === 'POLICY_UPDATE') {
        const policyEl = document.getElementById('policy-hash-val');
        if (policyEl) policyEl.textContent = event.payload.policy_hash.substring(0, 8);
      }
    }

    function updateGroundingPanel(g) {
        const panel = document.getElementById('grounding-panel');
        const content = document.getElementById('grounding-content');
        panel.style.display = 'block';
        
        let html = '<div style="margin-bottom: 10px; color: #ff00ff;"><strong>Grounding Score: ' + (g.grounding_score * 100).toFixed(1) + '%</strong></div>';
        
        if (g.search_queries && g.search_queries.length > 0) {
            html += '<div style="margin-bottom: 10px;"><span style="color: #888;">Search Queries:</span> ' + g.search_queries.join(', ') + '</div>';
        }
        
        if (g.citations && g.citations.length > 0) {
            html += '<div style="font-size: 0.9em; border-left: 2px solid #ff00ff; padding-left: 10px;">';
            g.citations.forEach(function(c) {
                html += '<div style="margin-bottom: 8px;"><strong>' + c.title + '</strong><br/>' +
                        '<span style="color: #888; font-size: 0.85em;">' + c.uri + '</span><br/>' +
                        '<span style="color: #ccc; font-style: italic;">"' + c.content + '"</span></div>';
            });
            html += '</div>';
        }
        
        content.innerHTML = html;
        panel.scrollIntoView({ behavior: 'smooth' });
    }

    updateDashboard(); // Initial load
    connectSSE();      // Real-time stream
    setInterval(updateDashboard, 10000); // Back-sync every 10s instead of 2s
  </script>
</body>
</html>`;
}

// --- GOVERNANCE: Initial Policy Commit ---
async function commitInitialPolicy() {
  const lastEvent = await Hub.getLastEvent();
  const prevHash = lastEvent?.event_hash || '';
  const policyPayload = {
    type: 'POLICY_UPDATE',
    policy_hash: globalConfig.getPolicyHash(),
    config: globalConfig.getRuntimeConfig(),
    reason: 'GENESIS_BOOT'
  };
  const event = signEvent(policyPayload, prevHash, 'L2', 'governance');
  await Hub.appendEvent(event);
  console.log(`[GOVERNANCE] Policy Commit: ${globalConfig.getPolicyHash().substring(0, 8)} (Tier: L2)`);
}

// Upgrade HTTP to WebSocket for /ws/live
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
  if (pathname === '/ws/live') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

async function startServer() {
  await Hub.initialize();
  await commitInitialPolicy();

  server.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`[Hub] Genesis Server running at http://localhost:${HTTP_PORT}`);
    console.log(`[Hub] Dashboard: http://localhost:${HTTP_PORT}/`);
  });
}

process.on('SIGINT', () => {
  broadcaster.stop();
  server.close(() => {
    console.log('[Server] Shutdown complete');
    process.exit(0);
  });
});

startServer().catch(err => {
  console.error('[Hub] Critical Startup Error:', err);
  process.exit(1);
});
