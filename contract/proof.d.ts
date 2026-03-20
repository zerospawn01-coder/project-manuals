import { BudgetSnapshot } from './budget';

export type LegitimacyTier = 'L0' | 'L1' | 'L2';

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

export declare function calculateEventHash(payload: any, prevHash: string): string;
export declare function signEvent(payload: any, prevHash: string, tier: LegitimacyTier, actorName: string): AntigravityEvent;
export declare function verifyEvent(event: AntigravityEvent): boolean;
export declare function verifyChain(events: AntigravityEvent[], initialHash?: string): boolean;
export declare function createGenesisEvent(payload: any, actorName: string): AntigravityEvent;