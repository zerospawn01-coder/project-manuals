"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useLiveSession = useLiveSession;
const react_1 = require("react");
const worldStore_1 = require("../state/worldStore");
const safeJson_1 = require("../lib/safeJson");
function useLiveSession() {
    const ws = (0, react_1.useRef)(null);
    const [connected, setConnected] = (0, react_1.useState)(false);
    const handleServerMessage = (0, worldStore_1.useStore)((state) => state.handleServerMessage);
    const connect = (0, react_1.useCallback)(() => {
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
            const data = safeJson_1.safeJson.parse(event.data, null);
            if (data) {
                handleServerMessage(data);
            }
        };
        ws.current = socket;
    }, [handleServerMessage]);
    (0, react_1.useEffect)(() => {
        connect();
        return () => ws.current?.close();
    }, [connect]);
    const send = (0, react_1.useCallback)((data) => {
        if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send(safeJson_1.safeJson.stringify(data));
        }
        else {
            console.warn('[LiveSession] Socket not open. Message dropped.');
        }
    }, []);
    return { connected, send };
}
