import axios from 'axios';

/** The API's address, written once in the workspace's own example file, `/v1` included. */
const tokensAt = `${import.meta.env.VITE_API_URL}/tokens`;

export default function Tokens() {
  const load = () => axios.get(`${tokensAt}/list`);
  const revoke = (id: string) => axios.delete(`${tokensAt}/revoke?id=${id}`);
  const openDoc = (slug: string) => fetch(`${import.meta.env.VITE_API_URL}/docs/${slug}`);
  return (
    <main>
      <button onClick={load}>Load</button>
      <button onClick={() => revoke('1')}>Revoke</button>
      <button onClick={() => openDoc('intro')}>Docs</button>
    </main>
  );
}
