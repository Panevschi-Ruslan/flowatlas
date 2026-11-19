import Router from 'next/router';

/** One order; the router's own `Router` takes the visitor back to the list in place of it. */
export default function OrderPage() {
  const back = () => Router.replace('/orders');
  return <button onClick={back}>Back</button>;
}
