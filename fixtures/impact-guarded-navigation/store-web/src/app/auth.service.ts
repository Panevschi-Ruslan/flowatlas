import { Injectable } from '@angular/core';

/** Who is signed in, kept in the browser. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private session: string | null = null;

  isSignedIn(): boolean {
    return this.session !== null;
  }

  role(): string {
    return this.session === null ? 'guest' : 'manager';
  }

  login(name: string): void {
    this.session = name;
  }
}
