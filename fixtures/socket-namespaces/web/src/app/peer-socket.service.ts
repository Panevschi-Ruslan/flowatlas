import { Injectable } from '@angular/core';
import { io, type Socket } from 'socket.io-client';

import { environment } from '../environments/environment';
import type { LiveState, Notification } from './live-events';

/**
 * The browser's half: one socket per namespace, each opened on an address
 * written as a settings key plus the path, with a `+`.
 */
@Injectable({ providedIn: 'root' })
export class PeerSocketService {
  private liveVideos: Socket;

  private notifications: Socket;

  private readonly control: Socket = io(environment.apiUrl);

  latest: LiveState | null = null;

  unread: Notification[] = [];

  connect(): void {
    this.notifications = io(environment.apiUrl + '/user-notifications');
    this.notifications.on('new-notification', (notification: Notification) => this.notify(notification));

    this.liveVideos = io(environment.apiUrl + '/live-videos');
    this.liveVideos.on('state-change', (state: LiveState) => this.apply(state));
  }

  watch(videoId: string): void {
    this.liveVideos.emit('subscribe', { videoId });
  }

  unwatch(videoId: string): void {
    this.liveVideos.emit('unsubscribe', { videoId });
  }

  ping(): void {
    this.control.emit('ping-server');
  }

  apply(state: LiveState): void {
    this.latest = state;
  }

  notify(notification: Notification): void {
    this.unread.push(notification);
  }
}
