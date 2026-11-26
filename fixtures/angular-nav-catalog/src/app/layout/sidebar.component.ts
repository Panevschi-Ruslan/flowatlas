import { computed, Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Observable } from 'rxjs';

import { NAV_CATALOG, PINNED, SECTIONS } from './nav-catalog';

/**
 * The sidebar: one link per entry of the catalog, through a computed signal
 * that filters it; the same entries grouped by section in a nested loop; the
 * pinned addresses as buttons that navigate; and links over a stream that
 * arrives at run time, which is not read.
 */
@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
})
export class SidebarComponent {
  readonly showHidden = signal(false);

  readonly items = computed(() => NAV_CATALOG.filter((item) => this.showHidden() || !item.hidden));

  readonly sections = computed(() =>
    SECTIONS.map((section) => ({ ...section, links: NAV_CATALOG.filter((item) => item.section === section.name) })),
  );

  readonly remote$: Observable<Array<{ path: string }>>;

  constructor(public router: Router) {}

  get pinned() {
    return PINNED.map((route) => ({ route, label: route.slice(1) }));
  }
}
