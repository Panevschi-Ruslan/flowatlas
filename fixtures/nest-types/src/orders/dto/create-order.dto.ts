import {
  ArrayNotEmpty,
  Exclude,
  Expose,
  IsInt,
  IsOptional,
  IsString,
  Transform,
  Type,
  ValidateNested,
} from '../../validation';

export class OrderItemDto {
  @IsString()
  sku: string;

  @IsInt()
  quantity: number;
}

export class CreateOrderDto {
  /** `meta.expose: true`, `meta.exposeAs: 'customer_id'`, `meta.validators: ['IsString']`. */
  @Expose({ name: 'customer_id' })
  @IsString()
  customerId: string;

  /** `optional: true`, `meta.optionalBy: 'IsOptional'` — the `?` and `@IsOptional()` agree here (D5). */
  @IsOptional()
  @IsString()
  note?: string;

  /** `items: type:nest-types#OrderItemDto[]`, `meta.typeFn: 'type:nest-types#OrderItemDto'`. */
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  /** `meta.exclude: true` — dropped on the wire, still a TS field. */
  @Exclude()
  secret: string;

  /** `meta.transform: true`; the argument is an arrow function → `decorator-arg-dynamic`. */
  @Transform(({ value }) => String(value).trim())
  couponCode: string;
}
