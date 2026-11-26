import { Component } from '@angular/core';
import { Router } from '@angular/router';

interface NavEntry {
  label: string;
  route: string;
}

/** The menu: one button per entry, each handing its entry to `go`, which navigates to the entry's address. */
const NAV_ENTRIES: NavEntry[] = [
  { label: 'Settings', route: '/settings' },
  { label: 'Reports', route: '/reports' },
  { label: 'Help', route: '/help' },
];

/**
 * The frame every page is shown in. `(click)="go(entry)"` inside the loop
 * hands `go` an entry of the list, so `go`'s navigation lands on each
 * entry's screen; `/help` is an address no route answers.
 */
@Component({
  selector: 'app-root',
  template: `
    <nav>
      @for (entry of entries; track entry.route) {
        <button (click)="go(entry)">{{ entry.label }}</button>
      }
    </nav>
    <router-outlet></router-outlet>
  `,
})
export class AppComponent {
  readonly entries = NAV_ENTRIES;

  constructor(private readonly router: Router) {}

  go(entry: NavEntry): void {
    this.router.navigate([entry.route]);
  }
}
