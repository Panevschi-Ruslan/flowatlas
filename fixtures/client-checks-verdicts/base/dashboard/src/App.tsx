import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ItemPage } from './ItemPage';

/** The dashboard's one screen. */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/items/current" element={<ItemPage />} />
      </Routes>
    </BrowserRouter>
  );
}
