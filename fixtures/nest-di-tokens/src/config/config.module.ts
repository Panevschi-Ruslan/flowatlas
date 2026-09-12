import { Module } from '@nestjs/common';

import { CONFIG } from '../tokens';

@Module({
  providers: [
    // useValue -> provider node kind `value`.
    { provide: CONFIG, useValue: { baseUrl: 'http://localhost:3000', retries: 3 } },
    // useFactory -> provider node kind `factory`.
    { provide: 'CLIENT', useFactory: () => ({ send: (message: string) => message }) },
  ],
  exports: [CONFIG, 'CLIENT'],
})
export class ConfigModule {}
