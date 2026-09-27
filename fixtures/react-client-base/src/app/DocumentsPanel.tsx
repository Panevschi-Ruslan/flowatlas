import { readDocument, renameDocument, reportOpened } from './documents';

/** The screen every edge in this fixture starts at. */
export const DocumentsPanel = () => {
  const open = () => readDocument('a');
  const rename = () => renameDocument('a', 'b');
  const report = () => reportOpened('a');

  return (
    <div>
      <button onClick={open}>Open</button>
      <button onClick={rename}>Rename</button>
      <button onClick={report}>Report</button>
    </div>
  );
};
