import type { Confirmation } from '../schemas/confirmation';

const confirmations = new Map<string, Confirmation>();

export function storeConfirmation(confirmation: Confirmation): Confirmation {
  confirmations.set(confirmation.confirmationId, confirmation);
  return confirmation;
}

export function getConfirmation(confirmationId: string): Confirmation | undefined {
  return confirmations.get(confirmationId);
}

export function revokeConfirmation(confirmationId: string): boolean {
  return confirmations.delete(confirmationId);
}

export function listConfirmations(): Confirmation[] {
  return [...confirmations.values()];
}
