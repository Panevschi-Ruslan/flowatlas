import { Component } from '@angular/core';
import { CrateService, type CrateEntityType } from './crate.service';

@Component({
  selector: 'app-translations-tab',
  standalone: true,
  template: `<button (click)="save()">Save</button>`,
})
export class TranslationsTabComponent {
  entityType: CrateEntityType = 'item';

  constructor(private readonly crate: CrateService) {}

  save(): void {
    this.crate.setCrates('t1', this.entityType, 'e1', { locale: 'ro', name: 'x' }).subscribe();
  }
}
