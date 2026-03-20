"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const react_1 = __importDefault(require("react"));
const worldStore_1 = require("../state/worldStore");
const DrainMonitor = () => {
    const nodes = (0, worldStore_1.useStore)((state) => state.nodes);
    const activeNodes = nodes.length;
    const drainRate = activeNodes > 0 ? Math.round((activeNodes / 10) * 100) : 0; // Mock calculation
    return (<div className="drain-monitor glass-panel">
            <div className="panel-header">
                <span>DRAIN_STATUS</span>
                <span className="drain-percent">{drainRate}%</span>
            </div>
            <div className="panel-value">
                {activeNodes} ACTIVE_NODES
            </div>
            <div className="progress-bg">
                <div className="progress-fill" style={{ '--progress-width': `${drainRate}%` }}></div>
            </div>
        </div>);
};
exports.default = DrainMonitor;
