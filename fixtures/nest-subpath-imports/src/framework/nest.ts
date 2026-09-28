/**
 * A barrel of this repository's own, re-exporting the framework's decorators.
 *
 * The decorator a class written against this barrel carries is Nest's, and
 * nothing here can prove it: the symbol the checker hands back for the name is
 * the import specifier in the file that used it, and that names this module. So
 * the reader cannot place the decorator in a package, and the one thing it may
 * not do about that is pass over the class in silence.
 */
export { Controller, Get } from '@nestjs/common';
