import { Component } from '@angular/core';

/** Routed at `/archive` and linked from nowhere: shown to whoever opens the address. */
@Component({
  selector: 'app-archive',
  standalone: true,
  template: `<h1>Archive</h1>`,
})
export class ArchiveComponent {}
