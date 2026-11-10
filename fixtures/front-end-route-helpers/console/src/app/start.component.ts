import { Component } from '@angular/core';
import { Router } from '@angular/router';

/** The start screen: buttons that navigate in the template itself. */
@Component({
  selector: 'app-start',
  template: `
    <button (click)="router.navigate(['/queue'])">Queue</button>
    <button (click)="router.navigateByUrl('/login')">Sign in</button>
    <button (click)="router.navigate(['/archive'])">Archive</button>
  `,
})
export class StartComponent {
  constructor(public readonly router: Router) {}
}
