import { Component } from '@angular/core';

/**
 * A template that is not there.
 *
 * The component is still a node — it exists and something declares it — and the
 * missing file is one row saying where to look, rather than a component that
 * quietly has no triggers.
 */
@Component({
  selector: 'app-legacy-panel',
  templateUrl: './legacy-panel.component.html',
})
export class LegacyPanelComponent {
  close(): void {
    this.open = false;
  }

  private open = true;
}
