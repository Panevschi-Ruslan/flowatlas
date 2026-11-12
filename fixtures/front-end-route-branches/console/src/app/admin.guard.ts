import { Injectable } from '@angular/core';
import { SessionService } from './session.service.js';

/** Lets only an administrator into the screens under the admin route. */
@Injectable({ providedIn: 'root' })
export class AdminGuard {
  constructor(private readonly session: SessionService) {}

  canActivateChild(): boolean {
    return this.session.hasRole('admin');
  }
}
