import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ItemPage } from './ItemPage';
import { ItemsList } from './ItemsList';

/** The dashboard's screens: the item list, and one item. */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/items" element={<ItemsList />} />
        <Route path="/items/current" element={<ItemPage />} />
      </Routes>
    </BrowserRouter>
  );
}
