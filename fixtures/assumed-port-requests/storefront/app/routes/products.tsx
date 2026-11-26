import { addToCart, listProducts, readCart } from '../lib/store.js';

export async function loader() {
  return { products: await listProducts(), cart: await readCart() };
}

export async function action({ request }: { request: Request }) {
  const form = await request.formData();
  return addToCart(String(form.get('productId')));
}

export default function Products() {
  return (
    <form method="post">
      <button type="submit">Add</button>
    </form>
  );
}
