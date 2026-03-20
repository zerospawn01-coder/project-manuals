import React from 'react';
import { useStore } from '../state/worldStore';

const DrainMonitor: React.FC = () => {
    const nodes = useStore((state) => state.nodes);
    const activeNodes = nodes.length;
    const drainRate = activeNodes > 0 ? Math.round((activeNodes / 10) * 100) : 0; // Mock calculation

    return (
        <div className="drain-monitor glass-panel">
            <div className="panel-header">
                <span>DRAIN_STATUS</span>
                <span className="drain-percent">{drainRate}%</span>
            </div>
            <div className="panel-value">
                {activeNodes} ACTIVE_NODES
            </div>
            <div className="progress-bg">
                <div
                    className="progress-fill"
                    style={{ '--progress-width': `${drainRate}%` } as React.CSSProperties}
                ></div>
            </div>
        </div>
    );
};

export default DrainMonitor;
