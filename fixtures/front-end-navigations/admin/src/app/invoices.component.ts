import { Component } from '@angular/core';
import { Router } from '@angular/router';

import { InvoicesService } from './invoices.service.js';

/** The list of invoices: reads the total off the answer, and opens one invoice. */
@Component({ selector: 'app-invoices', template: '<ul></ul>' })
export class InvoicesComponent {
  total = 0;

  constructor(
    private readonly invoices: InvoicesService,
    private readonly router: Router,
  ) {}

  load(): void {
    this.invoices.page(1).subscribe((res) => {
      this.total = Number(res.headers.get('X-Total-Count'));
    });
  }

  open(id: string): void {
    void this.router.navigate(['/invoices', id]);
  }
}
