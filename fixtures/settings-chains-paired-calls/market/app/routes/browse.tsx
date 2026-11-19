import { readEntries, readListings, readReviews } from '../lib/catalog.js';

export async function loader() {
  return { listings: await readListings(), entries: await readEntries(), reviews: await readReviews() };
}

export default function Browse() {
  const refresh = () => readListings();
  const balance = () => readEntries();
  const more = () => readReviews();
  return (
    <main>
      <button onClick={refresh}>Refresh</button>
      <button onClick={balance}>Balance</button>
      <button onClick={more}>More reviews</button>
    </main>
  );
}
