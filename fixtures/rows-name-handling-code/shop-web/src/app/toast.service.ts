import { Injectable } from '@angular/core';

/** Shows a short message. Every screen uses it, so whatever calls it is not reached through it. */
@Injectable({ providedIn: 'root' })
export class Toast {
  readonly shown: string[] = [];

  showInfo(text: string): void {
    this.shown.push(text);
  }
}
