import { AntigravityEvent } from '../contract/proof';

export declare const Hub: {
	initialize(): Promise<void>;
	getLastEvent(): Promise<AntigravityEvent | null>;
	appendEvent(event: AntigravityEvent): Promise<void>;
	readAll(): Promise<AntigravityEvent[]>;
};