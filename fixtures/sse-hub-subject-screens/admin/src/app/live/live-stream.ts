import { Subject, type Observable } from 'rxjs';

interface Opened {
  readonly url: string;
  readonly key: string;
  readonly select: (frame: { message?: unknown }) => unknown;
}

/**
 * One stream of server-sent events, generic over what its frames carry. Each
 * feature's stream service holds an instance of its own and hands it the
 * address: the frames of that instance reach only that service's screens.
 */
export class LiveStream<T> {
  private readonly subject = new Subject<T>();
  private source: EventSource | null = null;
  readonly events$: Observable<T> = this.subject.asObservable();

  constructor(private readonly platform: unknown) {}

  connect(url: string, key: string, select: (frame: { message?: unknown }) => T | null): void {
    this.source?.close();
    this.open({ url, key, select });
  }

  private open(p: Opened): void {
    const source = new EventSource(p.url);
    source.onmessage = (ev) => {
      const value = p.select(JSON.parse(ev.data)) as T | null;
      if (value != null) this.subject.next(value);
    };
    this.source = source;
  }
}
