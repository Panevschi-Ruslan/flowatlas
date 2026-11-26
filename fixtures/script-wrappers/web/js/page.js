// The page itself: everything it calls is a name another script handed it.
function start() {
  var cart = new Cart('guest');
  api.items().then(function (items) {
    cart.add(items[0], 1);
  });
  cart.coupon = 'WELCOME';
  window.reviews.list(1);
  stock.load();
  return cart.total.then(function () {
    return orders.place(cart);
  });
}

start();
