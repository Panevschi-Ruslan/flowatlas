/** A report, read by a loader on the server only. */
export async function readReport(year: string) {
  const res = await fetch(`${process.env.FILES_URL}/files/reports/${year}/summary`);
  return res.json();
}

/** A shared file, read by an action on the server and by a click in the browser. */
export async function readShared(name: string) {
  return fetch(`${process.env.FILES_URL}/files/shared/${name}`);
}

/** A preview, asked for only by a screen. */
export async function preview(name: string) {
  return fetch(`${process.env.FILES_URL}/files/previews/${name}`);
}
