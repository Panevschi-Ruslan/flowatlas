// A cart written as a constructor and its prototype.
function Cart(owner) {
  this.owner = owner;
  this.lines = [];
}

Cart.prototype.add = function (item) {
  this.lines.push(item);
  const request = new XMLHttpRequest();
  request.open('POST', `${SHOP}/cart`);
  request.setRequestHeader('Content-Type', 'application/json');
  request.send(JSON.stringify({ item: item.id, quantity: 1 }));
};

Cart.prototype.addAll = function (items) {
  items.forEach((item) => this.add(item));
};

Object.assign(Cart.prototype, {
  clear() {
    this.lines = [];
    return fetch(`${SHOP}/cart`, { method: 'DELETE' });
  },
});
