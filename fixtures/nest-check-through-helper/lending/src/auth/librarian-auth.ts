import { Injectable } from '@nestjs/common';

export interface Librarian {
  id: string;
  branch: string;
}

export type LibrarianCheck = { ok: true; librarian: Librarian } | { ok: false; reason: 'missing' | 'denied' | 'locked' };

/** Who is at the desk, read from the badge token a terminal sends. */
@Injectable()
export class LibrarianAuth {
  async verify(badge: string | undefined): Promise<LibrarianCheck> {
    if (badge === undefined || badge.length === 0) return { ok: false, reason: 'missing' };
    if (badge.startsWith('locked:')) return { ok: false, reason: 'locked' };
    if (!badge.startsWith('staff:')) return { ok: false, reason: 'denied' };
    return { ok: true, librarian: { id: badge.slice(6), branch: 'central' } };
  }
}
