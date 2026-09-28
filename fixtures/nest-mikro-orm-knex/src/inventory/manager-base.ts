/**
 * The repository base a project writes over its ORM: it hands a method the
 * manager for the transaction it is in.
 *
 * Generic in the manager, so each caller states which manager it wants in a
 * type argument - the only place the manager's type is written down.
 */
export abstract class ManagerBase {
  protected readonly defaultManager: unknown;

  protected getActiveManager<TManager>(): TManager {
    return this.defaultManager as TManager;
  }
}
