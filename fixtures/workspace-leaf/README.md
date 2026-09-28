# workspace-leaf

A package inside a workspace, declaring nothing of its own.

`api/package.json` is a name, a version and an exports map: exactly what the
leaf manifest of a real workspace member usually is. Everything the code imports
is declared one level up, in the root manifest that lists `api` as a member.

That is the whole point of the fixture. Adapter detection asks what a repository
depends on, and the answer has to be read off the workspace chain rather than
off the leaf alone. Read off the leaf alone this repository declares nothing,
every adapter switches off, and the graph that comes out is empty in a way
nobody can tell apart from a repository with no routes and no storage in it.

| Expected | Why |
|---|---|
| two routes under `orders` | the HTTP adapter is detected through the root manifest |
| two query sites, table `orders` | so is the data layer |
