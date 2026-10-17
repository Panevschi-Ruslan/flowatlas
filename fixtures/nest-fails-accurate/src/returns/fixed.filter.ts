import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';

/** Catches everything and always answers 400. */
@Catch()
export class FixedFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    host.switchToHttp().getResponse().status(400).json({ message: 'the loan could not be returned' });
  }
}
