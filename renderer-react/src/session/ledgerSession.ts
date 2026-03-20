import { useEffect, useRef } from 'react';
import { useStore } from '../state/worldStore';

export function useLedgerSession() {
    const handleServerMessage = useStore((state) => state.handleServerMessage);
    const eventSourceRef = useRef<EventSource | null>(null);

    useEffect(() => {
        const url = `${window.location.origin}/api/logs/stream`;
        console.log(`[LedgerSession] Connecting to SSE: ${url}`);

        const es = new EventSource(url);

        es.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                // Unified state update via patch
                handleServerMessage({
                    schemaVersion: 1,
                    runId: 'initial',
                    seq: Date.now(), // Monotonic sequence for live audit feed
                    source: 'LEDGER',
                    auditLogEntry: {
                        ts: data.ts || new Date().toISOString(),
                        action: data.action || 'LOG',
                        details: data.details || data.message || 'SYSTEM_INFO'
                    }
                });
            } catch (e) {
                console.error('[LedgerSession] SSE Parse Error:', e);
            }
        };

        es.onerror = () => {
            console.error('[LedgerSession] SSE Connection Error');
            es.close();
        };

        eventSourceRef.current = es;
        return () => es.close();
    }, [handleServerMessage]);
}
