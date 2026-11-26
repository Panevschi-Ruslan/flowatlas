import { Exclude } from 'class-transformer';

/** What the catalog answers for a product; the serializer leaves the cost price out. */
export class ProductCard {
  id: string;
  name: string;
  price: number;

  @Exclude()
  costPrice: number;
}
