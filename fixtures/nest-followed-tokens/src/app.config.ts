import { registerAs } from '@nestjs/config';

/** The shop's own settings, injected by `appConfig.KEY`. */
export default registerAs('app', () => ({
  currency: 'EUR',
}));
