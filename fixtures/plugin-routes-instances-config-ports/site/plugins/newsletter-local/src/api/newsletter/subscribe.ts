export default function subscribe(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  res.json({ subscribed: true });
}
