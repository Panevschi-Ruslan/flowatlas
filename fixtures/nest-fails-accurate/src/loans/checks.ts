import { PlainFailure } from '../errors';

/** A helper the graph does not draw: only its throw puts it on the route. */
export function assertBookId(bookId: string): void {
  if (bookId.length === 0) throw new PlainFailure('no book id');
}
