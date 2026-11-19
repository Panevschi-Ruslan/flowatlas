async function listBooks() {
  const answer = await fetch(`${CATALOG_API}/books`);
  return answer.json();
}
