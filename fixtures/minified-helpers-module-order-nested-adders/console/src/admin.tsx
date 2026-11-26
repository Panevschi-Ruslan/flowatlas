import { createRoot } from 'react-dom/client';
import './features/weather';
import App from './App';

// A second entry point: the widgets two entry points add to have no one order.
createRoot(document.getElementById('admin') as HTMLElement).render(<App />);
