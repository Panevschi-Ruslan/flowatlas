import { Controller, Sse } from '@nestjs/common';
import { interval, map, type Observable } from 'rxjs';

/** Three streams of server-sent events the shop's screens hold open. */
@Controller('orders')
export class StreamsController {
  /** Every frame is the event `order-ready`: Nest sends a `MessageEvent`'s `type` as the frame's `event:`. */
  @Sse('events')
  events(): Observable<MessageEvent> {
    return interval(5000).pipe(map((tick) => ({ data: { tick }, type: 'order-ready' }) as MessageEvent));
  }

  /** Frames named no event: what `onmessage` hears. */
  @Sse('feed')
  feed(): Observable<MessageEvent> {
    return interval(5000).pipe(map((tick) => ({ data: { tick } }) as MessageEvent));
  }

  /** Frames named `notice`, listened for by that name. */
  @Sse('notices')
  notices(): Observable<MessageEvent> {
    return interval(60000).pipe(map((tick) => ({ data: { tick }, type: 'notice' }) as MessageEvent));
  }
}
