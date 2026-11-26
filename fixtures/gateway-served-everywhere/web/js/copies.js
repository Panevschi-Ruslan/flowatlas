async function countCopies(bookId) {
  const answer = await fetch(`${STOCK_API}/copies/${bookId}`);
  return answer.json();
}
