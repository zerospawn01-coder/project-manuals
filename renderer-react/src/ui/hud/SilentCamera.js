"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const react_1 = __importStar(require("react"));
const react_webcam_1 = __importDefault(require("react-webcam"));
const lucide_react_1 = require("lucide-react");
const worldStore_1 = require("../../state/worldStore");
const silentSession_1 = require("../../session/silentSession");
const useLipReadingMock = () => {
    const WindowWithFaceMesh = window;
    return {
        faceMesh: WindowWithFaceMesh.FaceMesh ? new WindowWithFaceMesh.FaceMesh() : null,
        confidence: 0.9,
        activeIntent: 'STAGE_FIX'
    };
};
const SilentCamera = () => {
    const webcamRef = (0, react_1.useRef)(null);
    const [hasMediaError, setHasMediaError] = react_1.default.useState(false);
    const isSilent = (0, worldStore_1.useStore)((state) => state.isSilent);
    const { faceMesh, confidence, activeIntent } = useLipReadingMock();
    const { handleIntent } = (0, silentSession_1.useSilentSession)(webcamRef.current?.video || null, faceMesh);
    (0, react_1.useEffect)(() => {
        if (activeIntent) {
            handleIntent(activeIntent, confidence);
        }
    }, [activeIntent, confidence, handleIntent]);
    if (!isSilent)
        return null;
    return (<div className="silent-camera-hud glass-panel">
            <div className="hud-header">
                <lucide_react_1.Camera size={14} color="#00ff88"/>
                <span>SILENT MODE ACTIVE</span>
            </div>
            <div className="video-wrapper">
                {!hasMediaError ? (<react_webcam_1.default audio={false} ref={webcamRef} screenshotFormat="image/jpeg" videoConstraints={{ width: 320, height: 240, facingMode: "user" }} className="webcam-view" onUserMediaError={() => setHasMediaError(true)}/>) : (<div className="media-error-overlay">
                        <lucide_react_1.MicOff size={24} color="#ff4d4d"/>
                        <span>PERMISSION DENIED</span>
                    </div>)}
                {activeIntent && confidence > 0.5 && (<div className="intent-display">
                        <lucide_react_1.Zap size={12} fill="#00ff88"/>
                        <span className="intent-label">{activeIntent.replace('_', ' ')}</span>
                        <div className="confidence-bar" style={{ width: `${confidence * 100}%` }}></div>
                    </div>)}
            </div>
        </div>);
};
exports.default = SilentCamera;
