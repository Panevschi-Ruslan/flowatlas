import { Component, OnInit, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { filter } from 'rxjs';

import { environment } from '../../environments/environment';
import { DeskStreamService } from '../live/desk-stream.service';

/** The types that make the steps screen refetch. */
const TYPES: ReadonlySet<string> = new Set(['STEP_READY']);

/** Chooses STEP_READY in the pipe, then refetches the order: it reads nothing of the message. */
@Component({ selector: 'app-staff-steps', standalone: true, template: '<section></section>' })
export class StaffStepsComponent implements OnInit {
  private readonly stream = inject(DeskStreamService);
  private readonly http = inject(HttpClient);
  steps: string[] = [];

  ngOnInit(): void {
    this.stream.connect('demo');
    this.stream.event$.pipe(filter((e) => TYPES.has(e.type))).subscribe(() => this.load());
  }

  private load(): void {
    this.http.get<{ id: string; steps: string[] }>(`${environment.apiUrl}/api/demo/orders/o1`).subscribe((order) => {
      this.steps = order.steps;
    });
  }
}
