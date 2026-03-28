import { createHash, randomUUID } from 'node:crypto';

export type LegitimacyTier = 'L0' | 'L1' | 'L2';

export interface BudgetSnapshot {
  total_budget: number;
  spent_budget: number;
  remaining_budget: number;
  currency: string;
}

export interface ProofHeader {
  schema_version: 'proof/0.2';
  event_id: string;
  ts: string;
  prev_hash: string;
  event_hash: string;
  legitimacy_tier: LegitimacyTier;
  actor: {
    layer: 'contract' | 'hub' | 'renderer' | 'peripheral';
    name: string;
  };
  budget_snapshot: BudgetSnapshot;
}

export interface AntigravityEvent extends ProofHeader {
  payload: any;
  confidence?: number;
  [key: string]: any;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function emptyBudgetSnapshot(): BudgetSnapshot {
  return {
    total_budget: 0,
    spent_budget: 0,
    remaining_budget: 0,
    currency: 'USD',
  };
}

export function calculateEventHash(payload: any, prevHash: string): string {
  return createHash('sha256')
    .update(stableStringify({ payload, prevHash }))
    .digest('hex');
}

export function signEvent(
  payload: any,
  prevHash: string,
  tier: LegitimacyTier,
  actorName: string
): AntigravityEvent {
  const ts = new Date().toISOString();
  return {
    schema_version: 'proof/0.2',
    event_id: randomUUID(),
    ts,
    prev_hash: prevHash,
    event_hash: calculateEventHash(payload, prevHash),
    legitimacy_tier: tier,
    actor: {
      layer: 'contract',
      name: actorName,
    },
    budget_snapshot: emptyBudgetSnapshot(),
    payload,
  };
}

export function verifyEvent(event: AntigravityEvent): boolean {
  return calculateEventHash(event.payload, event.prev_hash) === event.event_hash;
}

export function verifyChain(events: AntigravityEvent[], initialHash = ''): boolean {
  let previous = initialHash;
  for (const event of events) {
    if (event.prev_hash !== previous) {
      return false;
    }
    if (!verifyEvent(event)) {
      return false;
    }
    previous = event.event_hash;
  }
  return true;
}

export function createGenesisEvent(payload: any, actorName: string): AntigravityEvent {
  return signEvent(payload, '', 'L2', actorName);
}
