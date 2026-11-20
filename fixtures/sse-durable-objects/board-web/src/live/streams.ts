/**
 * The streams every screen opens through the gateway, and the functions their
 * frames go to.
 */

export function onAlert(frame: MessageEvent): void {
  console.log('alert', frame.data);
}

export function onArchived(frame: MessageEvent): void {
  console.log('archived', frame.data);
}

export function onLedger(frame: MessageEvent): void {
  console.log('ledger', frame.data);
}

/** Every alert, relayed by the object that subscribes in its constructor. */
export function watchAlerts(): EventSource {
  const source = new EventSource(`${import.meta.env.VITE_GATEWAY_URL}/alerts/stream`);
  source.onmessage = onAlert;
  return source;
}

/** A board's archive, through an object whose class the gateway does not declare. */
export function watchArchive(boardId: string): EventSource {
  const source = new EventSource(`${import.meta.env.VITE_GATEWAY_URL}/boards/${boardId}/archive`);
  source.onmessage = onArchived;
  return source;
}

/** The ledger, through an object another worker declares. */
export function watchLedger(): EventSource {
  const source = new EventSource(`${import.meta.env.VITE_GATEWAY_URL}/ledger/stream`);
  source.addEventListener('message', onLedger);
  return source;
}
