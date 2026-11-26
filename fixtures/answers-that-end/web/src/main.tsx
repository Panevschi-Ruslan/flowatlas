import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { OrderPage } from './screens/OrderPage';

/** The app's one screen: an order. */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/orders/:id" element={<OrderPage id="1" />} />
      </Routes>
    </BrowserRouter>
  );
}
