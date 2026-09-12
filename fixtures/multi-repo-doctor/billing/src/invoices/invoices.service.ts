import { Injectable } from '@nestjs/common';
import { Consumes } from '@flowatlas/markers';

/** The ordinary work, and one annotation that has outlived its handler. */
@Injectable()
export class InvoicesService {
  record(orderId: string, amount: number): void {
    void orderId;
    void amount;
  }

  /**
   * The annotation that lies: nothing subscribes this, nothing calls it, and no
   * row says a channel was named here and could not be read. It was a handler
   * once; the registration went and the annotation stayed.
   * Expected: `marker-consumes-without-consumer`, an error.
   */
  @Consumes('order.refunded')
  onOrderRefunded(orderId: string): void {
    void orderId;
  }
}
