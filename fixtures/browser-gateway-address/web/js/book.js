async function bookSlot(slot, name) {
  return fetch(BOOK_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify({ slot, name }),
  }).then((answer) => answer.json());
}
