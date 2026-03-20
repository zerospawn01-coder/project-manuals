import { useState } from 'react';
import { useStore } from '../state/worldStore';
import { useSVPSession } from '../session/svp';
import { useLedgerSession } from '../session/ledgerSession';
import Topology2DView from '../views/Topology2D/Topology2DView';
import Blast3DView from '../views/Blast3D/Blast3DView';

import RunbookPanel from '../components/RunbookPanel';
import AuditTicker from '../components/AuditTicker';
import DrainMonitor from '../components/DrainMonitor';
import ExecutionGateModal from '../ui/overlays/ExecutionGateModal';
import SilentCamera from '../ui/hud/SilentCamera';
import AudioControl from '../ui/hud/AudioControl';
import TransactionFlowDemo from '../components/TransactionFlowDemo';

const App = () => {
    const { nodes, edges, is3D, isSilent, lastCommand, isSafeMode } = useStore();
    const { connected } = useSVPSession();
    useLedgerSession(); // Bind SSE Ledger

    const [showDemo, setShowDemo] = useState(true); // DEMO MODE: Default to true

    const statusText = connected ? 'CONNECTED' : 'DISCONNECTED';

    // If demo mode, show only the demo
    if (showDemo) {
        return (
            <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
                <button
                    onClick={() => setShowDemo(false)}
                    style={{
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
                    }}
                >
                    ✕ Close Demo
                </button>
                <TransactionFlowDemo />
            </div>
        );
    }

    return (
        <div className={`topology-container ${is3D ? 'view-3d' : ''}`}>
            {/* HUD */}
            <div className="hud-overlay glass-panel">
                <div className={`svp-status ${!connected ? 'stalled' : ''}`}>
                    SVP: {statusText}
                    {!connected && <span className="reconnect-pulse"> [RECONNECTING...]</span>}
                    {isSafeMode && <div className="safe-mode-alert"> [SAFE_MODE_ISOLATED]</div>}
                </div>
                <div className="command-log">LAST: {lastCommand} {isSilent ? '(SILENT)' : ''}</div>
                
                {/* Demo Button */}
                <button
                    onClick={() => setShowDemo(true)}
                    style={{
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
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(0, 212, 255, 1)';
                        e.currentTarget.style.transform = 'scale(1.05)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(0, 212, 255, 0.8)';
                        e.currentTarget.style.transform = 'scale(1)';
                    }}
                >
                    🛡️ View Transaction Gate Demo
                </button>
            </div>

            {/* Overlays & Panels */}
            <RunbookPanel />
            <AuditTicker />
            <DrainMonitor />
            <ExecutionGateModal />
            <SilentCamera />
            <AudioControl />

            {/* Primary View */}
            {is3D ? (
                <Blast3DView nodes={nodes} edges={edges} focusNode={nodes[0]} />
            ) : (
                <Topology2DView nodes={nodes} edges={edges} />
            )}
        </div>
    );
};

export default App;

