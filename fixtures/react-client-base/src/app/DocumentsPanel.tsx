import {
  readDocument,
  registerPasskey,
  renameDocument,
  reportOpened,
  verifyPasskey,
} from './documents';

/** The screen every edge in this fixture starts at. */
export const DocumentsPanel = () => {
  const open = () => readDocument('a');
  const rename = () => renameDocument('a', 'b');
  const report = () => reportOpened('a');
  const register = () => registerPasskey('a');
  const verify = () => verifyPasskey('a', window.location.pathname);

  return (
    <div>
      <button onClick={open}>Open</button>
      <button onClick={rename}>Rename</button>
      <button onClick={report}>Report</button>
      <button onClick={register}>Register</button>
      <button onClick={verify}>Verify</button>
    </div>
  );
};
