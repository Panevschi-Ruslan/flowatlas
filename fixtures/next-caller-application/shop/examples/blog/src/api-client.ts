/**
 * The two requests written inside the second application.
 *
 * `/api/orders` is declared here and in the root application, so it is the pair
 * that used to be ambiguous; `/api/posts` is spelled out only in the root
 * application, and here it is answered by this application's own catch-all.
 * Both mean this application, for the same reason: the browser asks the origin
 * the page came from, and that is decided by which application was deployed,
 * not by which of them spells the address out most fully.
 */
export const listOrders = async (): Promise<unknown> => {
  const answer = await fetch('/api/orders');
  return answer.json();
};

export const listPosts = async (): Promise<unknown> => {
  const answer = await fetch('/api/posts');
  return answer.json();
};
