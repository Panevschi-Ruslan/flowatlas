import { Component } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from './auth.service';

/** `/login`: signs in, then navigates to the dashboard. It calls none of the dashboard's code. */
@Component({
  standalone: true,
  selector: 'app-login',
  template: `<button (click)="handleAuth('me')">Sign in</button>`,
})
export class LoginComponent {
  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {}

  handleAuth(name: string): void {
    this.auth.login(name);
    void this.router.navigate(['/dashboard']);
  }
}
