import { CourierClient, sendViaCourier, type ReminderJob } from './courier-api';

/** What the platform binds at run time; nothing here says what any of it holds. */
export interface LibraryEnv {
  LIBRARY_BOT_TOKEN?: string;
}

/** Sends the reminders a loan falls due with, through the courier. */
export class ReminderDispatcher {
  private readonly courier = new CourierClient();

  constructor(private readonly env: LibraryEnv) {}

  /** The token is the platform's, which cannot be read: the helper keeps its request. */
  async dispatchOne(job: ReminderJob): Promise<'sent' | 'failed'> {
    const token = this.env.LIBRARY_BOT_TOKEN;
    if (!token) return 'failed';
    return (await sendViaCourier(token, job)) ? 'sent' : 'failed';
  }

  /** The same, through the method. */
  async dispatchOverdue(job: ReminderJob): Promise<'sent' | 'failed'> {
    const token = this.env.LIBRARY_BOT_TOKEN;
    if (!token) return 'failed';
    return (await this.courier.send(token, job)) ? 'sent' : 'failed';
  }
}
