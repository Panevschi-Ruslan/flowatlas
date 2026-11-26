/** Opens the upload, and hands the request back to be sent. */
function openUpload(): XMLHttpRequest {
  const request = new XMLHttpRequest();
  request.open('POST', '/api/uploads');
  request.setRequestHeader('Content-Type', 'application/json');
  return request;
}

export function Upload({ name }: { name: string }) {
  const start = () => {
    const sending = openUpload();
    sending.send(JSON.stringify({ name, size: 1 }));
  };
  return <button onClick={start}>Upload</button>;
}
