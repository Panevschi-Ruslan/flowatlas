import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { OrdersList } from './OrdersList';
import { ProfileCard } from './ProfileCard';

/** The app's screens: the orders, and the profile. */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/orders" element={<OrdersList />} />
        <Route path="/profile" element={<ProfileCard />} />
      </Routes>
    </BrowserRouter>
  );
}
