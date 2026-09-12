import { Action as Btn, Update } from 'nestjs-telegraf';
import { CB } from './callbacks.js';

/** An aliased import is still the same decorator, and a const still resolves. */
@Update()
export class PaymentsUpdate {
  @Btn(CB.CANCEL)
  cancel(): string {
    return 'cancelled';
  }
}
