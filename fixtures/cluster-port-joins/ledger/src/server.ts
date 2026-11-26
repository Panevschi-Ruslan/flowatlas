import { Inject, Injectable, type INestApplication } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import appConfig from './app.config';

/** Starts the ledger on the port its settings object says. */
@Injectable()
export class Server {
  constructor(@Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>) {}

  start(app: INestApplication): Promise<unknown> {
    return app.listen(this.config.port);
  }
}
