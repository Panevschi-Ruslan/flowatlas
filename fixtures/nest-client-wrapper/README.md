# nest-client-wrapper

A service whose outgoing requests all go through a client class it wrote itself.

`src/api/api-client.ts` settles the base address once, where the client is built,
and exposes `get`, `post` and `patch`; the path exists only at the call sites.
A reader that stopped at the `fetch` inside the client would learn nothing about
who calls what. The tool follows each verb method to the request it makes, so
every call site becomes its own `http_out` with its method and path, joined to
the `external_api` its base address names, and the settings key the address is
read from is a `config_key` node.
