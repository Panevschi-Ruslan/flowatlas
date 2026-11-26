function borrowBook(bookId, card) {
  const form = new FormData();
  form.append('bookId', bookId);
  form.append('card', card);
  const request = new XMLHttpRequest();
  request.open('POST', `${LOANS_API}/loans`);
  request.send(form);
}
