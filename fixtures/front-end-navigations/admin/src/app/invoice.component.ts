import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

/** One invoice: back to the list, a sibling relative to its own route, and an address no route answers. */
@Component({ selector: 'app-invoice', template: '<article></article>' })
export class InvoiceComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  back(): void {
    void this.router.navigateByUrl('/invoices');
  }

  next(id: string): void {
    void this.router.navigate([id], { relativeTo: this.route });
  }

  archive(): void {
    void this.router.navigateByUrl('/archive');
  }
}
