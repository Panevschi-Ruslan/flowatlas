/**
 * Generic template. Two entries are expected (D6):
 * - the bare `kind: generic` entry `type:nest-types#Paginated` with `typeParams: ['T']`
 * - the instantiation `type:nest-types#Paginated<type:nest-types#Order>` with substituted fields,
 *   from `OrdersService.list(): Promise<Paginated<Order>>`.
 */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
}
