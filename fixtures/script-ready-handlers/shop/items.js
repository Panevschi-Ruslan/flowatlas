const items = [{ id: 1, name: 'mug' }];

function listItems(page) {
  return items.slice((page - 1) * 10, page * 10);
}

function findItem(id) {
  return items.find((item) => item.id === id);
}

// Named by their own names: a caller requiring either joins the function.
module.exports = { listItems, findItem: findItem };
