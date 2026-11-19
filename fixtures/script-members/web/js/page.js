// What the page does when it opens: the calls reach the object's methods and
// the cart's prototype.
async function start() {
  const items = await api.items();
  await api.reviews.list(items[0].id);
  const cart = new Cart('guest');
  cart.addAll(items);
  cart.clear();
}

start();
