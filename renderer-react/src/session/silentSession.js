"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useSilentSession = useSilentSession;
const react_1 = require("react");
const worldStore_1 = require("../state/worldStore");
const svp_1 = require("./svp");
function useSilentSession(videoElement, faceMesh) {
    const { isSilent } = (0, worldStore_1.useStore)();
    const { routeCommand } = (0, svp_1.useSVPSession)();
    const cameraRef = (0, react_1.useRef)(null);
    (0, react_1.useEffect)(() => {
        if (!isSilent || !videoElement || !faceMesh)
            return;
        // Implementation assuming @mediapipe/camera_utils is available on window or imported
        const Camera = window.Camera;
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
            if (cameraRef.current)
                cameraRef.current.stop();
        };
    }, [isSilent, videoElement, faceMesh]);
    const handleIntent = (intent, confidence) => {
        if (confidence > 0.8) {
            const mapping = {
                'STATUS_NOW': 'SHOW_STATUS',
                'STAGE_FIX': 'LOAD_RUNBOOK',
                'ROLLBACK_ARM': 'PLAN_ROLLBACK',
                'EXECUTE': 'OPEN_2FA',
                'VERIFY_SLO': 'VERIFY_RECOVERY'
            };
            const command = mapping[intent];
            if (command)
                routeCommand(command);
        }
    };
    return { handleIntent };
}
