/** The old back office, served by `react-scripts start`. */
export const Invoices = () => {
  const load = () => fetch('/invoices');
  return <button onClick={load}>Invoices</button>;
};
