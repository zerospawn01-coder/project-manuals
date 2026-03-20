import { useRef, useState, useCallback, useEffect } from 'react';
import { useStore } from '../state/worldStore';
import { safeJson } from '../lib/safeJson';

export function useLiveSession() {
    const ws = useRef<WebSocket | null>(null);
    const [connected, setConnected] = useState(false);
    const handleServerMessage = useStore((state) => state.handleServerMessage);

    const connect = useCallback(() => {
        // Use window.location to determine the backend host
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.hostname === 'localhost' ? 'localhost:7777' : window.location.host;
        const url = `${protocol}//${host}/ws/live`;

        console.log(`[LiveSession] Connecting to ${url}`);
        const socket = new WebSocket(url);

        socket.onopen = () => {
            console.log('[LiveSession] Connected');
            setConnected(true);
        };

        socket.onclose = () => {
            console.log('[LiveSession] Disconnected. Retrying in 3s...');
            setConnected(false);
            setTimeout(connect, 3000);
        };

        socket.onmessage = (event) => {
            const data = safeJson.parse(event.data, null);
            if (data) {
                handleServerMessage(data);
            }
        };

        ws.current = socket;
    }, [handleServerMessage]);

    useEffect(() => {
        connect();
        return () => ws.current?.close();
    }, [connect]);

    const send = useCallback((data: Record<string, unknown>) => {
        if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send(safeJson.stringify(data));
        } else {
            console.warn('[LiveSession] Socket not open. Message dropped.');
        }
    }, []);

    return { connected, send };
}
