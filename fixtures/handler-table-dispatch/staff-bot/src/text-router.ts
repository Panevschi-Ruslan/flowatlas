import { Injectable } from '@nestjs/common';
import type { Context } from 'telegraf';

import { replyStock } from './replies';
import { StaffApi } from './staff.api';

export interface TextCommand {
  command: string;
  run: (ctx: Context, api: StaffApi) => Promise<void>;
}

/** Text typed at the bot, matched to a command by `===`. */
const TEXT_COMMANDS: readonly TextCommand[] = [
  { command: 'stock', run: replyStock },
  { command: 'ping', run: async (ctx) => ctx.reply('pong') },
];

@Injectable()
export class TextRouter {
  constructor(private readonly api: StaffApi) {}

  async route(ctx: Context): Promise<void> {
    const text = ctx.message?.text ?? '';
    const match = TEXT_COMMANDS.find((entry) => entry.command === text);
    if (match) await match.run(ctx, this.api);
  }
}
