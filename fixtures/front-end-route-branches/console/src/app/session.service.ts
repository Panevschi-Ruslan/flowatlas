import { Injectable } from '@angular/core';

/** Who is signed in, and what they may do. */
@Injectable({ providedIn: 'root' })
export class SessionService {
  isSignedIn(): boolean {
    return localStorage.getItem('session') !== null;
  }

  hasRole(role: string): boolean {
    return (localStorage.getItem('roles') ?? '').split(',').includes(role);
  }
}
