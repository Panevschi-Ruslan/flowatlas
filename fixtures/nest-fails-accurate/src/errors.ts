/** Every error of the library's own: each says the status it means. */
export abstract class DomainError extends Error {
  abstract readonly status: number;
}

/** States its status as a property. */
export class LoanNotFound extends DomainError {
  readonly status = 404;

  constructor(id: string) {
    super(`loan ${id} not found`);
  }
}

/** A base that keeps the status it is handed. */
export abstract class StatusError extends DomainError {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Hands its status to the base that keeps it. */
export class LoanOverdue extends StatusError {
  constructor(id: string) {
    super(`loan ${id} is overdue`, 409);
  }
}

/** Answers its status from a getter. */
export class ShelfLocked extends DomainError {
  get status(): number {
    return 423;
  }
}

/** Says no status at all: whatever answers it, nothing here wrote one. */
export class PlainFailure extends Error {}
