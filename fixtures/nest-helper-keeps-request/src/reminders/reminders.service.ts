import { Injectable } from '@nestjs/common';

import { sendViaCourier } from './courier-api';

@Injectable()
export class RemindersService {
  /** A token written where it is passed: this caller decides the address, and is drawn on. */
  remindAtDesk(chatId: string): Promise<boolean> {
    return sendViaCourier('desk-bot', { borrowerChatId: chatId, text: 'Your hold is ready at the desk.' });
  }
}
