import { InjectionToken } from '@angular/core';

/**
 * A token that is not a class.
 *
 * Nothing can be pointed at, which is exactly the point: the injection is
 * recorded as `inject-token-unresolved` and never guessed at.
 */
export const API_KEY = new InjectionToken<string>('API_KEY');
