import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';

import { ShopError } from './errors';

/** Answers every error of the shop's own with the status it states. */
@Catch(ShopError)
export class ShopErrorFilter implements ExceptionFilter {
  catch(e: ShopError, host: ArgumentsHost): void {
    host.switchToHttp().getResponse().status(e.status).json({ message: e.message });
  }
}
