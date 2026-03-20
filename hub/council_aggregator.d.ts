import { AntigravityEvent } from '../contract/proof';

export interface CouncilEvent extends AntigravityEvent {
	node_id: string;
	node_seq: number;
	[key: string]: any;
}

export interface QuarantineRecord {
	node_id: string;
	reason: string;
	detail?: string;
	since_ts: string;
	last_ts?: string;
	fail_count: number;
	last_valid_seq: number;
}

export declare class CouncilAggregator {
	constructor(opts?: {
		aggregatorId?: string;
		emit?: (ev: unknown) => Promise<void> | void;
	});
	registerNode(nodeId: string, url: string): void;
	setLocalHeadHash(headHash: string | null): void;
	aggregateAllNodes(): Promise<CouncilEvent[]>;
	getCouncilLogs(): CouncilEvent[];
	getQuarantinedNodes(): QuarantineRecord[];
	recordCount(metric: string, value: number): void;
}