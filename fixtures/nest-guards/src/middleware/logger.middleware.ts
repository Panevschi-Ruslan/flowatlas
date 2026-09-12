import { Injectable, NestMiddleware } from '@nestjs/common';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  use(request: unknown, response: unknown, next: () => void): void {
    void request;
    void response;
    next();
  }
}
