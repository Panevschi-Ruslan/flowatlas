function rateBook(bookId, stars, comment) {
  const request = new XMLHttpRequest();
  request.open('POST', `${CATALOG_API}/books/${bookId}/ratings`);
  request.setRequestHeader('Content-Type', 'application/json');
  request.send(JSON.stringify({ stars, comment }));
}
