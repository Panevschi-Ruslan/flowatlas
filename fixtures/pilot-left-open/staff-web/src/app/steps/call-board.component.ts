import { Component, OnInit, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

import { environment } from '../../environments/environment';
import { DeskStreamService } from '../live/desk-stream.service';

/** Chooses two types in its callback and refetches: the message is handed to nothing. */
@Component({ selector: 'app-call-board', standalone: true, template: '<aside></aside>' })
export class CallBoardComponent implements OnInit {
  private readonly stream = inject(DeskStreamService);
  private readonly http = inject(HttpClient);
  open: string[] = [];

  ngOnInit(): void {
    this.stream.connect('demo');
    this.stream.event$.subscribe((evt) => {
      if (evt.type === 'CALL_STAFF' || evt.type === 'STEP_READY') this.load();
    });
  }

  private load(): void {
    this.http.get<{ id: string; steps: string[] }>(`${environment.apiUrl}/api/demo/orders/o2`).subscribe((order) => {
      this.open = order.steps;
    });
  }
}
