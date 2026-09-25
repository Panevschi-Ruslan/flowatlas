/**
 * The requests this repository makes, written as plain exported functions.
 *
 * Nothing here is markup, so this file was read even before the fallback
 * compiler options named a `jsx` setting. It is here to give the screen next
 * door something to reach: a component nobody can follow out of the repository
 * proves less than one whose click ends at an address.
 */
export interface OrderDto {
  id: string;
  name: string;
}

export const listOrders = async (): Promise<OrderDto[]> => {
  const answer = await fetch('/api/orders');
  return answer.json();
};
