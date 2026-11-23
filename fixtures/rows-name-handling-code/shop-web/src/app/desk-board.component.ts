import { Component, type OnInit } from '@angular/core';
import { filter } from 'rxjs';

import { LiveEvents } from './live-events.service';
import { Toast } from './toast.service';

/** `/desks`: reloads its list when a desk asks for help. The subscription that really runs. */
@Component({
  standalone: true,
  selector: 'app-desk-board',
  template: `<p>{{ calls }}</p>`,
})
export class DeskBoardComponent implements OnInit {
  calls = 0;

  constructor(
    private readonly events: LiveEvents,
    private readonly toast: Toast,
  ) {}

  ngOnInit(): void {
    this.events.connect();
    this.events.stream$.pipe(filter((event) => event.type === 'HELP_REQUESTED')).subscribe(() => this.reload());
  }

  reload(): void {
    this.calls += 1;
    this.toast.showInfo('A desk needs help');
  }
}
