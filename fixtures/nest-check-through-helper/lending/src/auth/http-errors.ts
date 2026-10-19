import { ForbiddenException, GoneException, HttpException, NotFoundException, UnauthorizedException } from '@nestjs/common';

/** A badge that was locked after too many wrong tries. */
export class LockedAccountError extends HttpException {
  constructor(message: string) {
    super(message, 423);
  }
}

/** Why a librarian was turned away, and what the terminal is answered with. */
const DENIALS = {
  missing: UnauthorizedException,
  denied: ForbiddenException,
  locked: LockedAccountError,
} as const;

/** The one place a refused badge becomes an exception: chosen from the table at run time. */
export const toHttpError = (refused: { reason: keyof typeof DENIALS }) => new DENIALS[refused.reason](refused.reason);

/** Statistics nobody may see yet, or that were withdrawn: not a check of who is asking. */
const NOT_THERE = {
  unknown: NotFoundException,
  withdrawn: GoneException,
} as const;

export const toNotFound = (why: keyof typeof NOT_THERE) => new NOT_THERE[why](`statistics ${why}`);
