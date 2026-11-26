import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

interface ClientRequest {
  params: Record<string, unknown>;
  query: Record<string, unknown>;
  body?: Record<string, unknown>;
}

/** Where a route says the client's id is; a route that says nothing has it in the body's `userRef`. */
interface ActsAs {
  in: 'param' | 'query' | 'body';
  name: string;
}

interface ClientOptions {
  actsAs?: ActsAs;
}

/** Lets a request through when it names the client it acts for. */
@Injectable()
export class ClientGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ClientRequest>();
    const options = (context.getHandler() as { clientOptions?: ClientOptions }).clientOptions ?? {};
    return this.suppliedId(request, options) !== undefined;
  }

  suppliedId(req: ClientRequest, options: ClientOptions): string | undefined {
    const source = options.actsAs ?? { in: 'body', name: 'userRef' };
    let bag: Record<string, unknown> | undefined;
    if (source.in === 'param') bag = req.params;
    else if (source.in === 'query') bag = req.query;
    else bag = req.body;
    const raw = bag?.[source.name];
    return typeof raw === 'string' ? raw : undefined;
  }
}
