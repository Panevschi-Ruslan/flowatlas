/**
 * A lending library's chat courier: one request, written once, whose bot token
 * is handed in by whoever sends the reminder.
 */

export interface ReminderJob {
  borrowerChatId: string;
  text: string;
  edit?: boolean;
}

/** A module-level helper: the token is its caller's, the method its own. */
export async function sendViaCourier(token: string, job: ReminderJob): Promise<boolean> {
  let method: string;
  if (job.edit) {
    method = 'editMessageText';
  } else {
    method = 'sendMessage';
  }
  const response = await fetch(`https://api.example.test/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: job.borrowerChatId, text: job.text }),
  });
  return response.ok;
}

/** The same request written as a method, followed out by the same rule. */
export class CourierClient {
  async send(token: string, job: ReminderJob): Promise<boolean> {
    const response = await fetch(`https://api.example.test/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: job.borrowerChatId, text: job.text }),
    });
    return response.ok;
  }
}
