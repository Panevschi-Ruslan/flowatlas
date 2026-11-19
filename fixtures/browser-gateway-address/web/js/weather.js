async function forecast() {
  const answer = await fetch(FORECAST_ENDPOINT);
  return answer.json();
}
