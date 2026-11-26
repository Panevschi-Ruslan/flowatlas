async function loadSlots() {
  const answer = await fetch(SLOTS_ENDPOINT);
  const { slots } = await answer.json();
  return slots;
}
