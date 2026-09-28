# nest-di-tokens

Injection by token rather than by class: `@Inject(CONFIG)` and the providers
that register those tokens, across six modules.

A token provided in exactly one place resolves to that provider. The three cases
that cannot be resolved each write their own row instead of an edge:

| Row | When |
|---|---|
| `di-token-ambiguous` | two modules provide the same token |
| `di-token-unknown` | nothing in the repository provides the token |
| `call-through-token` | a call is made through a token whose provider is a value, not a class |
