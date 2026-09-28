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

## A method every object has

`src/orders/prototype-names.ts` calls `toString`, `constructor`, `valueOf` and
`hasOwnProperty` on the redis client and on the axios client. The graph holds no
node for any line of it, asserted in
`packages/adapters-db/src/leaves-pass.test.ts`.

Two different things had to be true for that. The table of HTTP verbs is keyed by
a name read from the source, so it is a `Map` and has no prototype to fall
through. The cache reader never consulted its table to decide *whether* a call is
a cache operation — an unrecognised method is ordinary, since a client declares
hundreds of commands and `other` is the honest answer for the rest — so
`cache.hasOwnProperty('status')` was recorded as a cache operation on the key
`status`, a node with a label no person wrote. The receiver's type says the call
reaches the library; it does not say the method belongs to it, and a name the
language gives every value is the one case where the two come apart (R130).
