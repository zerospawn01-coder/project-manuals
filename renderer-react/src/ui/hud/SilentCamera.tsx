import React, { useRef, useEffect } from 'react';
import Webcam from 'react-webcam';
import { Camera, Zap, MicOff } from 'lucide-react';
import { useStore } from '../../state/worldStore';
import { useSilentSession, FaceMeshInstance } from '../../session/silentSession';

// Mocking useLipReading for this refactor demo
interface FaceMeshMock {
    new(): FaceMeshInstance;
}

interface LipReadingResult {
    faceMesh: FaceMeshInstance | null;
    confidence: number;
    activeIntent: string;
}

const useLipReadingMock = (): LipReadingResult => {
    const WindowWithFaceMesh = window as unknown as Record<string, FaceMeshMock>;
    return {
        faceMesh: WindowWithFaceMesh.FaceMesh ? new WindowWithFaceMesh.FaceMesh() : null,
        confidence: 0.9,
        activeIntent: 'STAGE_FIX'
    };
};

const SilentCamera: React.FC = () => {
    const webcamRef = useRef<Webcam>(null);
    const [hasMediaError, setHasMediaError] = React.useState(false);
    const isSilent = useStore((state) => state.isSilent);
    const { faceMesh, confidence, activeIntent } = useLipReadingMock();

    const { handleIntent } = useSilentSession(
        webcamRef.current?.video || null,
        faceMesh
    );

    useEffect(() => {
        if (activeIntent) {
            handleIntent(activeIntent, confidence);
        }
    }, [activeIntent, confidence, handleIntent]);

    if (!isSilent) return null;

    return (
        <div className="silent-camera-hud glass-panel">
            <div className="hud-header">
                <Camera size={14} color="#00ff88" />
                <span>SILENT MODE ACTIVE</span>
            </div>
            <div className="video-wrapper">
                {!hasMediaError ? (
                    <Webcam
                        audio={false}
                        ref={webcamRef}
                        screenshotFormat="image/jpeg"
                        videoConstraints={{ width: 320, height: 240, facingMode: "user" }}
                        className="webcam-view"
                        onUserMediaError={() => setHasMediaError(true)}
                    />
                ) : (
                    <div className="media-error-overlay">
                        <MicOff size={24} color="#ff4d4d" />
                        <span>PERMISSION DENIED</span>
                    </div>
                )}
                {activeIntent && confidence > 0.5 && (
                    <div className="intent-display">
                        <Zap size={12} fill="#00ff88" />
                        <span className="intent-label">{activeIntent.replace('_', ' ')}</span>
                        <div className="confidence-bar" style={{ width: `${confidence * 100}%` }}></div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SilentCamera;
