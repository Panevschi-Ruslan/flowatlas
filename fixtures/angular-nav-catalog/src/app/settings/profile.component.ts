import { Component } from '@angular/core';

/** Reached by the sidebar's pinned button, which navigates to `/settings/profile`. */
@Component({
  selector: 'app-profile',
  standalone: true,
  template: `<h1>Profile</h1>`,
})
export class ProfileComponent {}
