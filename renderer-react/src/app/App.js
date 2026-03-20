"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const react_1 = require("react");
const worldStore_1 = require("../state/worldStore");
const svp_1 = require("../session/svp");
const ledgerSession_1 = require("../session/ledgerSession");
const Topology2DView_1 = __importDefault(require("../views/Topology2D/Topology2DView"));
const Blast3DView_1 = __importDefault(require("../views/Blast3D/Blast3DView"));
const RunbookPanel_1 = __importDefault(require("../components/RunbookPanel"));
const AuditTicker_1 = __importDefault(require("../components/AuditTicker"));
const DrainMonitor_1 = __importDefault(require("../components/DrainMonitor"));
const ExecutionGateModal_1 = __importDefault(require("../ui/overlays/ExecutionGateModal"));
const SilentCamera_1 = __importDefault(require("../ui/hud/SilentCamera"));
const AudioControl_1 = __importDefault(require("../ui/hud/AudioControl"));
const TransactionFlowDemo_1 = __importDefault(require("../components/TransactionFlowDemo"));
const App = () => {
    const { nodes, edges, is3D, isSilent, lastCommand, isSafeMode } = (0, worldStore_1.useStore)();
    const { connected } = (0, svp_1.useSVPSession)();
    (0, ledgerSession_1.useLedgerSession)(); // Bind SSE Ledger
    const [showDemo, setShowDemo] = (0, react_1.useState)(true); // DEMO MODE: Default to true
    const statusText = connected ? 'CONNECTED' : 'DISCONNECTED';
    // If demo mode, show only the demo
    if (showDemo) {
        return (<div style={{ position: 'relative', width: '100%', height: '100vh' }}>
                <button onClick={() => setShowDemo(false)} style={{
                position: 'fixed',
                top: '1rem',
                right: '1rem',
                zIndex: 9999,
                background: 'rgba(255, 68, 68, 0.8)',
                color: 'white',
                border: '2px solid #ff4444',
                borderRadius: '8px',
                padding: '0.75rem 1.5rem',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '1rem',
                backdropFilter: 'blur(10px)'
            }}>
                    ✕ Close Demo
                </button>
                <TransactionFlowDemo_1.default />
            </div>);
    }
    return (<div className={`topology-container ${is3D ? 'view-3d' : ''}`}>
            {/* HUD */}
            <div className="hud-overlay glass-panel">
                <div className={`svp-status ${!connected ? 'stalled' : ''}`}>
                    SVP: {statusText}
                    {!connected && <span className="reconnect-pulse"> [RECONNECTING...]</span>}
                    {isSafeMode && <div className="safe-mode-alert"> [SAFE_MODE_ISOLATED]</div>}
                </div>
                <div className="command-log">LAST: {lastCommand} {isSilent ? '(SILENT)' : ''}</div>
                
                {/* Demo Button */}
                <button onClick={() => setShowDemo(true)} style={{
            position: 'absolute',
            top: '1rem',
            right: '1rem',
            background: 'rgba(0, 212, 255, 0.8)',
            color: 'white',
            border: '2px solid #00d4ff',
            borderRadius: '8px',
            padding: '0.75rem 1.5rem',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '1rem',
            backdropFilter: 'blur(10px)',
            transition: 'all 0.3s ease'
        }} onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(0, 212, 255, 1)';
            e.currentTarget.style.transform = 'scale(1.05)';
        }} onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(0, 212, 255, 0.8)';
            e.currentTarget.style.transform = 'scale(1)';
        }}>
                    🛡️ View Transaction Gate Demo
                </button>
            </div>

            {/* Overlays & Panels */}
            <RunbookPanel_1.default />
            <AuditTicker_1.default />
            <DrainMonitor_1.default />
            <ExecutionGateModal_1.default />
            <SilentCamera_1.default />
            <AudioControl_1.default />

            {/* Primary View */}
            {is3D ? (<Blast3DView_1.default nodes={nodes} edges={edges} focusNode={nodes[0]}/>) : (<Topology2DView_1.default nodes={nodes} edges={edges}/>)}
        </div>);
};
exports.default = App;
