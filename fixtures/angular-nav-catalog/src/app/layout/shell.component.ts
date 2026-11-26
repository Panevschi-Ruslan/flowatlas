import { Component } from '@angular/core';

/** The frame every page is shown in: the sidebar beside the outlet. */
@Component({
  selector: 'app-shell',
  template: `
    <app-sidebar></app-sidebar>
    <router-outlet></router-outlet>
  `,
})
export class ShellComponent {}
