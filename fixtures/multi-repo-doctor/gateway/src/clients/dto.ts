/**
 * What the gateway believes it is sending.
 *
 * `orders` requires a `channel` on the way in and this does not declare one, so
 * the two declarations disagree and no compiler either repository runs can say
 * so. That disagreement is the contract error the health check reports.
 */
export interface CreateOrderDto {
  id: string;
  total: number;
}

export interface OrderDto {
  id: string;
  total: number;
}
