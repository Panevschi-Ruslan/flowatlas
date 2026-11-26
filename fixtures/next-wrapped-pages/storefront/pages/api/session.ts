import { sessionHandler } from 'auth-kit';

// A package's handler built from a configuration and handed nothing this
// repository declares: the way in is here and nothing behind it is, which is a
// row saying the export was built.
export default sessionHandler({ cookie: 'sid' });
