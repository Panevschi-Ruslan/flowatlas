import { Component } from '@angular/core';

import { ItemsClient } from './items.client';

/** `/settings`: injects the client and keeps it for later; calls none of its methods. */
@Component({
  standalone: true,
  selector: 'app-settings-page',
  template: `<p>Settings</p>`,
})
export class SettingsPageComponent {
  constructor(readonly client: ItemsClient) {}
}
