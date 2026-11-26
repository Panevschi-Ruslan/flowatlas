import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

interface NoteRequest {
  body?: Record<string, unknown>;
}

/** Lets a note through when it is short; its helper copies the whole body first. */
@Injectable()
export class NoteGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<NoteRequest>();
    return this.noteOf(request).length < 500;
  }

  noteOf(req: NoteRequest): string {
    const copy = { ...req.body };
    return String(copy['note'] ?? '');
  }
}
