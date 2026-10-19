/** The nightly job: asks the catalogue to rebuild its search index. */
export async function reindex(): Promise<void> {
  await fetch(process.env.REINDEX_URL, { method: 'POST' });
}
