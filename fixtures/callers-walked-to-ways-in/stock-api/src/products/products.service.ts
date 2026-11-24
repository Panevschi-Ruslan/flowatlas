import { Injectable } from '@nestjs/common';

/** The catalog the products routes read and write. */
@Injectable()
export class ProductsService {
  private readonly names = new Map<string, string>();

  list(): string[] {
    return [...this.names.keys()];
  }

  one(sku: string): string {
    return this.names.get(sku) ?? '';
  }

  create(sku: string, name: string): string {
    this.names.set(sku, name);
    return sku;
  }

  rename(sku: string, name: string): string {
    this.names.set(sku, name);
    return sku;
  }

  remove(sku: string): void {
    this.names.delete(sku);
  }
}
