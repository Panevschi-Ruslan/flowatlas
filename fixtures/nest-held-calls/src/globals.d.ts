// Ambient declarations so the fixture needs no installed type packages. A real
// repository would get these from its platform types.

declare const process: { env: Record<string, string | undefined> };
