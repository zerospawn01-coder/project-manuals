import { useStore } from '../state/worldStore';

/**
 * SVP (Special Voice Protocol) Command Definitions
 */
export const SVP_COMMANDS = {
    STAGE_FIX: 'STAGE_FIX',
    ROLLBACK_ARM: 'ROLLBACK_ARM',
    INIT_ROLLBACK: 'INIT_ROLLBACK',
    OPEN_2FA: 'OPEN_2FA',
    TOGGLE_3D: 'TOGGLE_3D',
    TOGGLE_SILENT: 'TOGGLE_SILENT'
};

export function useCommandRouter(send: (data: Record<string, unknown>) => void) {
    const store = useStore.getState();

    const routeCommand = (action: string) => {
        console.log(`[CommandRouter] Routing: ${action}`);

        // Handle internal UI toggles first
        if (action === SVP_COMMANDS.TOGGLE_3D) {
            store.toggle3D();
            return;
        }
        if (action === SVP_COMMANDS.TOGGLE_SILENT) {
            store.toggleSilent();
            return;
        }

        // Forward operational commands to server
        store.dispatchSVP(action, send);
    };

    return { routeCommand };
}
