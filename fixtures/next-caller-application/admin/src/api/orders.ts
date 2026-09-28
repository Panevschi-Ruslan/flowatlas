/**
 * A request from outside every application of the service it names.
 *
 * It is rooted at a settings key, which the configuration says means `shop`.
 * Which of shop's two applications answers it is decided by what is deployed
 * behind that address and no source here says, so both are named and neither
 * is chosen — the answer R119 settled on, and the one this fixture exists to
 * show is unchanged.
 */
const base = import.meta.env.VITE_API_URL;

export const listOrders = async (): Promise<unknown> => {
  const answer = await fetch(`${base}/api/orders`);
  return answer.json();
};
