import { preview, readReport, readShared } from '../lib/files.js';
import { whoAmI } from '../session.server.js';

export async function loader() {
  await whoAmI();
  return readReport('2026');
}

export async function action() {
  return readShared('terms');
}

export default function Reports() {
  const open = () => readShared('readme');
  const look = () => preview('cover');
  return (
    <main>
      <button onClick={open}>Open</button>
      <button onClick={look}>Preview</button>
    </main>
  );
}
