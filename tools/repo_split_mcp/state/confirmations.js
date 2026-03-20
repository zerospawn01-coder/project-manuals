"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.storeConfirmation = storeConfirmation;
exports.getConfirmation = getConfirmation;
exports.revokeConfirmation = revokeConfirmation;
exports.listConfirmations = listConfirmations;
const confirmations = new Map();
function storeConfirmation(confirmation) {
    confirmations.set(confirmation.confirmationId, confirmation);
    return confirmation;
}
function getConfirmation(confirmationId) {
    return confirmations.get(confirmationId);
}
function revokeConfirmation(confirmationId) {
    return confirmations.delete(confirmationId);
}
function listConfirmations() {
    return [...confirmations.values()];
}
