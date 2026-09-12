/**
 * A data layer written by hand over a driver this repository does not depend
 * on. No package declares any of it, so nothing here is recognisable unless the
 * configuration names the base class.
 */
export abstract class MongoStore<T> {
  protected abstract readonly collectionName: string;

  protected readonly rows = new Map<string, T>();

  protected async one(id: string): Promise<T | null> {
    return this.rows.get(id) ?? null;
  }

  protected async put(id: string, row: T): Promise<T> {
    this.rows.set(id, row);
    return row;
  }
}
