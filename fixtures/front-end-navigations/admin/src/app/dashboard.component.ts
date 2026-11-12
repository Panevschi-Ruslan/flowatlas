import { Component } from '@angular/core';
import { Router } from '@angular/router';

/** The start screen: a link in its template, and a way out of the application. */
@Component({ selector: 'app-dashboard', template: '<a routerLink="/invoices">Invoices</a>' })
export class DashboardComponent {
  constructor(private readonly router: Router) {}

  billing(): void {
    void this.router.navigateByUrl('https://billing.example.com/portal');
  }
}
