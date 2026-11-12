import { useMemo } from 'react';

/** A value made once per mount. */
export function useMemoized<T>(make: () => T): T {
  const held = useMemo(() => ({ value: make() }), []);
  return held.value;
}
