# unreadable-file

A repository of four files, one of which is not TypeScript at all.

The bootstrap, the module and the controller read normally, so the graph has a
route in it and the fixture is not merely a failure; they are also the reason
this fixture's only unresolved row is the one it exists for.
`src/orders/broken.ts` is genuine garbage — an unclosed parameter list followed
by punctuation — and the parser gives up on it.

That file is the whole point. Before R70 it was counted among the files read and
produced nothing else: no node, no edge, no row, no mention anywhere, and the
only trace of it was a file count arguing it had been read. The snapshot beside
this file now carries one `file-not-parsed` row naming it, at the default level,
because a file that did not parse is a hole in the graph rather than a note
about the reader's limits.
