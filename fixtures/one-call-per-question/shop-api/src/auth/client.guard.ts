import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

interface ClientRequest {
  body?: { userRef?: string };
  headers: Record<string, string | undefined>;
}

/** Lets a request through when it names the client it acts for. */
@Injectable()
export class ClientGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ClientRequest>();
    return this.clientRef(request) !== undefined;
  }

  clientRef(request: ClientRequest): string | undefined {
    return request.body?.userRef ?? request.headers['x-user-ref'];
  }
}
