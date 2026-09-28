import { createContext } from 'react';

const SdkContext = createContext<string | null>(null);

/**
 * For an application that renders with React and supplies it. The API is not
 * one: it declares no React of its own and depends on this package directly, so
 * the peer this component needs is one nobody here supplies.
 */
export function SdkProvider({ token, children }: { token: string; children: unknown }) {
  return <SdkContext.Provider value={token}>{children as never}</SdkContext.Provider>;
}
