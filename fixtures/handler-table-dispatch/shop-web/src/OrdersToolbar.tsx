import { countStock, loadReport, markReady } from './orders-api';

/**
 * A toolbar of actions written as a table: each button runs its element's
 * `run`, chosen by key with `===`. One element holds a function the file
 * declares, one an arrow calling an imported function, one an imported
 * function itself.
 */
const reload = (): Promise<unknown> => loadReport();

const TOOLBAR = [
  { key: 'refresh', run: reload },
  { key: 'ready', run: () => markReady('first') },
  { key: 'stock', run: countStock },
] as const;

export const OrdersToolbar = () => {
  const onAction = (key: string): void => {
    const action = TOOLBAR.find((each) => each.key === key);
    void action?.run();
  };
  const refresh = (): void => onAction('refresh');
  const ready = (): void => onAction('ready');
  const stock = (): void => onAction('stock');
  return (
    <nav>
      <button onClick={refresh}>Refresh</button>
      <button onClick={ready}>Mark first ready</button>
      <button onClick={stock}>Stock</button>
    </nav>
  );
};
