import { Component, inject, type OnInit } from '@angular/core';

import { AuthService } from './auth.service';
import type { CreateOrderDto } from './order.dto';
import { OrdersApiService } from './orders-api.service';
import { SharedModule } from './shared.module';

/**
 * Every trigger a template can carry, including the two that lead nowhere.
 *
 * The chain the whole phase exists for starts here: `(click)="submit()"` reaches
 * `submit`, which reaches `OrdersApiService.create`, which is one
 * `POST /orders`.
 */
@Component({
  standalone: true,
  selector: 'app-checkout',
  imports: [SharedModule],
  template: `
    <form (ngSubmit)="save(form)">
      <input (change)="onChange($event)" (input)="onInput($event)" (keyup.enter)="submit()" />
      <button (click)="submit()">Order</button>
      <button (click)="orders.refresh()">Refresh</button>
      <button (click)="sumbit()">Typo</button>
      <button (click)="open = !open">Toggle</button>
      <a routerLink="/orders/:id">Orders</a>
      <a routerLink="/settings">Settings</a>
      <a routerLink="/reports">Reports</a>
      <a routerLink="/profile">Profile</a>
      <a routerLink="/archive">Archive</a>
    </form>
  `,
})
export class CheckoutComponent implements OnInit {
  open = false;
  form: CreateOrderDto = { customerId: '', total: 0 };

  private readonly auth = inject(AuthService);

  constructor(readonly orders: OrdersApiService) {}

  ngOnInit(): void {
    this.orders.list();
  }

  submit(): void {
    this.orders.create(this.form);
  }

  save(body: CreateOrderDto): void {
    this.orders.create(body);
  }

  onChange(event: unknown): void {
    this.form = { ...this.form, customerId: String(event) };
  }

  onInput(event: unknown): void {
    this.form = { ...this.form, total: Number(event) };
  }

  token(): string {
    return this.auth.token();
  }
}
