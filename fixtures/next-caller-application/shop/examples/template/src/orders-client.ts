/**
 * A request inside the application that spells nothing out.
 *
 * It reaches its own catch-all, and that is the whole story: no route of *this*
 * application spells `/api/orders` out, and the two that do belong to programs
 * this one is never deployed with. Counting their routes made this request
 * report that the service has a spelled-out route it is missing — a sentence
 * about the wrong program, and 35 of the 36 joins R125 cost carried it (R132).
 */
export const listOrders = async (): Promise<unknown> => {
  const answer = await fetch('/api/orders');
  return answer.json();
};
