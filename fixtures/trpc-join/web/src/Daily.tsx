import { useTRPC } from './trpc';

/** The newer binding: the proxy is a hook's result, and the leaf makes options. */
export function Daily() {
  const trpc = useTRPC();
  const options = trpc.reports.daily.queryOptions();
  return <div>{String(options)}</div>;
}
