# nest-basic

The smallest NestJS service the tool reads end to end: three modules, a users
controller and its service, wired by injection.

It holds the baseline every other NestJS fixture builds on: controllers become
`entry` nodes with their HTTP address, providers and modules become nodes, and
each handler's `handles` edge reaches the method behind it. A route whose path is
not a literal is a `route-path-dynamic` row, and a constructor parameter whose
type the checker cannot resolve is a `di-type-unresolved` row, rather than either
being guessed.
