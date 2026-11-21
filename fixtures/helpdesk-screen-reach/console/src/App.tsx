import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueueScreen } from './screens/QueueScreen';
import { TicketScreen } from './screens/TicketScreen';

/** The console's screens: the queue, and one ticket. */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/queue" element={<QueueScreen />} />
        <Route path="/tickets/:ticketId" element={<TicketScreen />} />
      </Routes>
    </BrowserRouter>
  );
}
