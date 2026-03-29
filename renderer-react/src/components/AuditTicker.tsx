import { useStore } from '../state/worldStore';

const AuditTicker = () => {
    const entries = useStore((state) => state.auditLog.slice(0, 6));
    const items = entries.length
        ? entries
        : [{ ts: '--:--:--', action: 'STANDBY', details: 'Awaiting ledger events.' }];

    return (
        <div className="audit-ticker glass-panel" aria-live="polite">
            <span className="ticker-label">AUDIT</span>
            <div className="ticker-content">
                {[...items, ...items].map((item, index) => (
                    <div className="ticker-item" key={`${item.action}-${item.ts}-${index}`}>
                        <span>{item.ts}</span>
                        <span>{item.action}</span>
                        <span>{item.details}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default AuditTicker;
