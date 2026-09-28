import { ButtonLink } from '@rendered-mail/ui';

/** The frame every message is written inside. */
export function Layout({ children }: { children: unknown }) {
  return (
    <table>
      <tbody>
        <tr>
          <td>{children as never}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** The receipt itself: a component, rendered on the server into an e-mail. */
export function Receipt({ orderId }: { orderId: string }) {
  return (
    <Layout>
      <p>Thank you for order {orderId}.</p>
      <ButtonLink href={`https://shop.example/orders/${orderId}`} label="View order" />
    </Layout>
  );
}
