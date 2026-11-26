import { Injectable } from '@nestjs/common';

export interface User {
  id: string;
  currency: string;
  email: string;
}

export interface WishItem {
  id: string;
  name: string;
  cents: number;
}

@Injectable()
export class AccountsService {
  private readonly users = new Map<string, User>();
  private readonly items = new Map<string, WishItem>();

  current(): User | undefined {
    return this.users.values().next().value;
  }

  user(id: string): User | undefined {
    return this.users.get(id);
  }

  item(id: string): WishItem | undefined {
    return this.items.get(id);
  }

  wishlist(userId: string): WishItem[] {
    return [...this.items.values()].filter((item) => item.id.startsWith(userId));
  }

  price(itemId: string, currency: string): number {
    const cents = this.items.get(itemId)?.cents ?? 0;
    return currency === 'EUR' ? cents / 100 : cents / 110;
  }
}
