# nest-leaves

Cache keys, outgoing addresses and configuration reads.

| Call site | Expected |
|---|---|
| `cache.get('orders:index')` | `get`, pattern `orders:index`, static |
| `cache.get(\`orders:${id}\`)` | `get`, pattern `orders:*`, static |
| `cache.del(key)` | `del`, no pattern, heuristic, `dynamic-cache-key` |
| `http.get(\`${config.get('ORDERS_URL')}/orders/${id}\`)` | `GET`, base `ORDERS_URL`, path `/orders/:param`, static |
| `http.post(\`${config.get('ORDERS_URL')}/orders\`, body)` | `POST`, base `ORDERS_URL`, path `/orders`, body type recorded |
| `axios.post('https://api.stripe.com/v1/charges', …)` | `POST`, host `api.stripe.com`, third-party node |
| `axios.get(url)` | no path, heuristic, `dynamic-http-url` |
| `fetch('https://example.test/health', { method: 'HEAD' })` | `HEAD`, host `example.test` |
| `config.get('FEATURE_X')` | key `FEATURE_X` |
| `config.get('TIMEOUT_MS', '5000')` | key `TIMEOUT_MS` with its fallback |
| `process.env.NODE_ENV` | key `NODE_ENV` |
| `config.get(name)` | nothing, `dynamic-config-key` |
