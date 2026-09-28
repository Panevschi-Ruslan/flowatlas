/**
 * What the mailer's own tests render to look at a receipt. It is written in
 * React because React is one of the mailer's devDependencies, which the API
 * never installs.
 */
export function Preview({ orderId }: { orderId: string }) {
  return <p>Receipt for {orderId}</p>;
}
