// The entry points re-export the operations they run, read off a namespace
// import: once as a property, once by its name in brackets.
import * as loans from '../operations/loans';

export const createLoan = loans.createLoan;
export const renewLoan = loans['renewLoan'];
