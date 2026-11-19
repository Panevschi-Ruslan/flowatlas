/** Sends one visit to the audit service. */
export async function recordVisit(path: string): Promise<void> {
  await fetch('http://audit.internal/visits', { method: 'POST', body: JSON.stringify({ path }) });
}
