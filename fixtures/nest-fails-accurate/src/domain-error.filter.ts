import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';

import { DomainError } from './errors';

/** Answers every error of the library's own with the status it states. */
@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter {
  catch(e: DomainError, host: ArgumentsHost): void {
    host.switchToHttp().getResponse().status(e.status).json({ message: e.message });
  }
}
