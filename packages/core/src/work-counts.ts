/**
 * How often, in this process, the parts of a reading that should happen once
 * a build or once a program actually ran (P82).
 *
 * Read by the tests that hold them to it: an index of the package sources is
 * made by the build, not by every reader it starts, and the files a program
 * read from a mount are walked once per program. Nothing in a reading reads
 * these, and nothing resets them; a test takes the difference.
 */
export const WORK_COUNTS = {
  /** `packageIndexOf` answers worked out, not remembered. */
  packageIndexes: 0,
  /** Shape files parsed by `readShapeFile`. */
  shapeFilesRead: 0,
  /** Walks over a program's files for the ones read from a mount. */
  mountedFileWalks: 0,
};
