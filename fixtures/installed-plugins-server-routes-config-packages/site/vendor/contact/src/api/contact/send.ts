export default function send(req, res) {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }
  res.json({ sent: true });
}
