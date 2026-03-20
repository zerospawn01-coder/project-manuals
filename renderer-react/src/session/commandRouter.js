"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SVP_COMMANDS = void 0;
exports.useCommandRouter = useCommandRouter;
const worldStore_1 = require("../state/worldStore");
/**
 * SVP (Special Voice Protocol) Command Definitions
 */
exports.SVP_COMMANDS = {
    STAGE_FIX: 'STAGE_FIX',
    ROLLBACK_ARM: 'ROLLBACK_ARM',
    INIT_ROLLBACK: 'INIT_ROLLBACK',
    OPEN_2FA: 'OPEN_2FA',
    TOGGLE_3D: 'TOGGLE_3D',
    TOGGLE_SILENT: 'TOGGLE_SILENT'
};
function useCommandRouter(send) {
    const store = worldStore_1.useStore.getState();
    const routeCommand = (action) => {
        console.log(`[CommandRouter] Routing: ${action}`);
        // Handle internal UI toggles first
        if (action === exports.SVP_COMMANDS.TOGGLE_3D) {
            store.toggle3D();
            return;
        }
        if (action === exports.SVP_COMMANDS.TOGGLE_SILENT) {
            store.toggleSilent();
            return;
        }
        // Forward operational commands to server
        store.dispatchSVP(action, send);
    };
    return { routeCommand };
}
