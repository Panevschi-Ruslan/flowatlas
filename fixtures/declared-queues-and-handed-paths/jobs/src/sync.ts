/** The shop's address written beside a path each caller hands in, on the server. */
async function shopGet(path: string): Promise<unknown> {
  const res = await fetch('https://shop.example.test' + path);
  return res.json();
}

async function shopPost(path: string, body: unknown): Promise<void> {
  await fetch(`https://shop.example.test${path}`, { method: 'POST', body: JSON.stringify(body) });
}

export async function syncProducts(): Promise<unknown> {
  return shopGet('/products');
}

export async function reorder(order: unknown): Promise<void> {
  await shopPost('/orders', order);
}

/** A path handed in by nothing here: left unread, not the shop's root. */
export async function shopDelete(path: string): Promise<void> {
  await fetch('https://shop.example.test' + path, { method: 'DELETE' });
}
