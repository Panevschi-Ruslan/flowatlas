# narrow-root-bounds-extends-lint-spreads fixture

A plain-script page whose client globals a linter plugin declares in
configurations written before spreads of other modules, and an Express
service whose tsconfig extends a configuration installed inside it and names
code above the directory the run reads. `catalog` listens at 4800. What P357
reads:

1. **A key written before a spread of another module's object.**
   `pages/node_modules/eslint-plugin-shop/index.js` writes each configuration
   before a spread of another module's `configs`, and the later one wins only
   where that module writes the same key, so each module spread is read to
   see:
   - `browser` (`ky`) is followed by `...base.configs`; `base.js` writes no
     `browser`, so the plugin's own declares `ky` and `items`' `/items` is a
     request.
   - `forms` declares nothing, and `...forms.configs` after it writes its own
     `forms` declaring `superagent`, which wins: `orders`' `/orders` is a
     request.
   - `legacy` (`axios`) is followed by `...legacy.configs`, a module that is
     not there to read: the `legacy` written before it is taken, so `stock`'s
     `/stock` is a request, and the spread is said beside it.
2. **The spread that could not be read, in a row.** Nothing declares `$`, so
   `legacy`'s `$.get(...)` is an `api-client-global-undeclared` row, which
   names what the linter configuration names and was not followed: the
   `./legacy` spread, written after each of the three configurations.
3. **A tsconfig extending a package installed inside.**
   `catalog/tsconfig.json` extends `@shop/tsconfig`, resolved from
   `catalog/node_modules` as the compiler resolves it: nothing to say.
4. **A tsconfig naming code above the run's root.** Its `include` also names
   `../../../shared-contracts/src/**/*.ts`, above the directory the
   configuration is in, which is all the run reads: a
   `tsconfig-not-read-above-root` row says it is not read.

The run's root here is the fixture, narrower than the checkout it is kept
in; no walk up from either service reads above it.
