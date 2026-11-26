/** The streams the plain worker serves from its own fetch. */

export function onDigest(frame: MessageEvent): void {
  console.log('digest', frame.data);
}

export function onTeamCard(frame: MessageEvent): void {
  console.log('team', frame.data);
}

export function watchDigest(): EventSource {
  const source = new EventSource(`${import.meta.env.VITE_DIGEST_URL}/digest/stream`);
  source.onmessage = onDigest;
  return source;
}

export function watchTeam(teamId: string): EventSource {
  const source = new EventSource(`${import.meta.env.VITE_DIGEST_URL}/teams/${teamId}/feed`);
  source.addEventListener('message', onTeamCard);
  return source;
}
