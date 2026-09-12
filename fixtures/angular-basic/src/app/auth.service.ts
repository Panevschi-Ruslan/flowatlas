import { Injectable } from '@angular/core';

/** Injected into a component through a field rather than the constructor. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  token(): string {
    return 'token';
  }
}
