import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ItemCard } from './ItemCard';

/** The app's one screen. */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/items/:id" element={<ItemCard />} />
      </Routes>
    </BrowserRouter>
  );
}
