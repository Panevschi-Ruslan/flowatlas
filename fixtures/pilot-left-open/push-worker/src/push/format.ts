/** A call for staff as a push line. */
export const formatCall = (input: { scopeId: string; roomId: string; roomNumber: string; calledAt: string }): string =>
  `${input.roomNumber}: staff called at ${input.calledAt}`;

/** A step that is ready as a push line. */
export const formatStepReady = (input: { orderId?: string; step?: string; assigned: string[] }): string =>
  `${input.orderId ?? '?'} ${input.step ?? ''} ready (${input.assigned.length})`;
