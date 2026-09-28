# react-no-tsconfig

A browser repository with no tsconfig in it, which is the shape `extract` meets
whenever it is pointed at a bare directory rather than at a configured project.
Every other fixture here carries a tsconfig, so until this one existed the
compiler options the tool falls back to when there is none were never exercised
by anything.

The whole of the fixture is one screen and the module it makes its request
through. What it proves is that the `.tsx` file is read as source: the button,
the component and the call from one to the other are all in the snapshot, and
the request it makes has an address. Before R62 the fallback options named no
`jsx` setting, so the compiler answered `Cannot use JSX unless the '--jsx' flag
is provided` for every file of markup in a repository like this one.

There is no `node_modules` either, deliberately. Nothing here needs a dependency
resolved to be read, and a fixture that quietly needed one would be testing the
install rather than the reader.
