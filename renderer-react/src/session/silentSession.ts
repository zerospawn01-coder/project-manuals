import { useEffect, useRef } from 'react';
import { useStore } from '../state/worldStore';
import { useSVPSession } from './svp';

interface CameraInstance {
    start(): Promise<void>;
    stop(): void;
}

interface CameraConstructor {
    new(video: HTMLVideoElement, options: Record<string, unknown>): CameraInstance;
}

export interface FaceMeshInstance {
    send(data: { image: HTMLVideoElement }): Promise<void>;
}

export function useSilentSession(videoElement: HTMLVideoElement | null, faceMesh: FaceMeshInstance | null) {
    const { isSilent } = useStore();
    const { routeCommand } = useSVPSession();
    const cameraRef = useRef<CameraInstance | null>(null);

    useEffect(() => {
        if (!isSilent || !videoElement || !faceMesh) return;

        // Implementation assuming @mediapipe/camera_utils is available on window or imported
        const Camera = (window as unknown as Record<string, CameraConstructor>).Camera;
        if (Camera) {
            cameraRef.current = new Camera(videoElement, {
                onFrame: async () => {
                    await faceMesh.send({ image: videoElement });
                },
                width: 640,
                height: 480
            });
            cameraRef.current.start();
        }

        return () => {
            if (cameraRef.current) cameraRef.current.stop();
        };
    }, [isSilent, videoElement, faceMesh]);

    const handleIntent = (intent: string, confidence: number) => {
        if (confidence > 0.8) {
            const mapping: Record<string, string> = {
                'STATUS_NOW': 'SHOW_STATUS',
                'STAGE_FIX': 'LOAD_RUNBOOK',
                'ROLLBACK_ARM': 'PLAN_ROLLBACK',
                'EXECUTE': 'OPEN_2FA',
                'VERIFY_SLO': 'VERIFY_RECOVERY'
            };
            const command = mapping[intent];
            if (command) routeCommand(command);
        }
    };

    return { handleIntent };
}
