/**
 * A plain module, no framework: it opens streams and names the functions their
 * frames go to.
 */

function onTick(frame: MessageEvent): void {
  console.log('tick', frame.data);
}

function onRoomMessage(frame: MessageEvent): void {
  console.log('room', frame.data);
}

/** Through the worker, which relays the workspace's channel. */
export function startTicker(workspaceId: string): EventSource {
  const source = new EventSource(`${import.meta.env.VITE_EDGE_URL}/live/${workspaceId}`);
  source.addEventListener('message', onTick);
  return source;
}

/** Through the worker to an object of its own: joined to the route, and to no channel. */
export function joinRoom(roomId: string): EventSource {
  const source = new EventSource(`${import.meta.env.VITE_EDGE_URL}/rooms/${roomId}/stream`);
  source.onmessage = onRoomMessage;
  return source;
}

/** An address no service answers: reported as a request that hits no route. */
export function watchNotices(): EventSource {
  const source = new EventSource(`${import.meta.env.VITE_SHIPPING_URL}/notices/stream`);
  source.onmessage = (frame) => onTick(frame);
  return source;
}
