export interface Subscription {
  videoId: string;
}

export interface LiveState {
  videoId: string;
  state: 'waiting' | 'published' | 'ended';
}

export interface Notification {
  id: number;
  text: string;
}
