import { Server, type Namespace, type Socket } from 'socket.io';

import type { LiveState, Notification, Subscription } from './live-events';

const authenticate = (socket: Socket, next: (error?: Error) => void): void => {
  void socket;
  next();
};

/**
 * The server's half of the sockets, written the way a plain server writes it.
 *
 * No gateway and no decorator: the namespace is the value `io.of(…)` returns,
 * and every handler registered on it, and every publish made through it, is
 * addressed within it. So `subscribe` here is `live-videos/subscribe`, the same
 * node the browser reaches by opening `…/live-videos` and emitting `subscribe`.
 */
export class PeerSockets {
  private liveVideos: Namespace;

  private readonly notificationSockets = new Map<number, Socket[]>();

  readonly watching = new Set<string>();

  init(httpServer: unknown): void {
    const io = new Server(httpServer);

    // Sockets kept for later: which namespace a socket read back out of the map
    // was opened on is not something the value says, so the publish below
    // cannot be placed on this namespace and is not.
    io.of('/user-notifications')
      .use(authenticate)
      .on('connection', (socket) => {
        this.remember(1, socket);
      });

    // The namespace kept on a field, and the connection handed to the handler
    // registered on it: both say `live-videos`, through the chain.
    this.liveVideos = io
      .of('/live-videos')
      .use(authenticate)
      .on('connection', (socket) => {
        socket.on('subscribe', (params: Subscription) => this.subscribe(params));
        socket.on('unsubscribe', (params: Subscription) => this.unsubscribe(params));
      });

    // The root namespace, said by saying nothing. The control: it joined before
    // and it still does.
    io.on('connection', (socket) => {
      socket.on('ping-server', () => this.pong());
    });
  }

  /** Published to the audience of one video, on the namespace the field holds. */
  sendState(state: LiveState): void {
    this.liveVideos.in(state.videoId).emit('state-change', state);
  }

  /** Published on a socket read back out of a map: the namespace is not stated. */
  sendNotification(userId: number, notification: Notification): void {
    for (const socket of this.notificationSockets.get(userId) ?? []) {
      socket.emit('new-notification', notification);
    }
  }

  subscribe(params: Subscription): void {
    this.watching.add(params.videoId);
  }

  unsubscribe(params: Subscription): void {
    this.watching.delete(params.videoId);
  }

  pong(): void {
    this.watching.add('pong');
  }

  remember(userId: number, socket: Socket): void {
    this.notificationSockets.set(userId, [...(this.notificationSockets.get(userId) ?? []), socket]);
  }
}
