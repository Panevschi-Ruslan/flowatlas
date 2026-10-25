import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';

import { DomainError } from '../errors';

const pick = (error: unknown): number => (error instanceof DomainError ? error.status : 500);

/** Answers with a status a helper picks: nothing here can read which. */
@Catch()
export class PickedStatusFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    host.switchToHttp().getResponse().status(pick(exception)).json({ message: 'report failed' });
  }
}
