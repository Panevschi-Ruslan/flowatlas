import { useEffect, useState } from 'react';

export default function Home() {
  const [products, setProducts] = useState([]);
  useEffect(() => {
    fetch('http://localhost:4310/api/products')
      .then((res) => res.json())
      .then(setProducts);
  }, []);
  const subscribe = (email: string) => fetch('/api/subscribe', { method: 'POST', body: JSON.stringify({ email }) });
  return (
    <main>
      <h1>Shop</h1>
      <button onClick={() => subscribe('reader@example.com')}>Subscribe</button>
      <ul>{products.length}</ul>
    </main>
  );
}
