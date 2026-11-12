async function latestReviews() {
  const answer = await fetch(`${REVIEWS_API}/reviews`);
  return answer.json();
}
