import { Subject, type Observable } from 'rxjs';

export interface BoardEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * The web app's stream of a board's events: frames pushed into a subject,
 * exposed through a getter. One instance, made where the module is loaded.
 */
export class BoardFeed {
  private readonly subject = new Subject<BoardEvent>();
  private source: EventSource | null = null;

  get events$(): Observable<BoardEvent> {
    return this.subject.asObservable();
  }

  connect(boardId: string): void {
    this.source?.close();
    const source = new EventSource(`${import.meta.env.VITE_BOARDS_URL}/api/boards/${boardId}/events`);
    source.onmessage = (m) => this.subject.next(JSON.parse(m.data) as BoardEvent);
    this.source = source;
  }
}

export const boardFeed = new BoardFeed();
