/**
 * The operations an OpenAPI document declares, walked in one place for every
 * reader of such a document.
 *
 * Two readers ask: the linker, for a service nobody here can read and that is
 * described by its document (P19), and a deployment reader, for an API whose
 * routes are written as the document it is created from (R174). They want
 * different things of each operation - shapes, or what it is integrated with -
 * and the same walk to find the operations: which keys of a path item are verbs,
 * and in what order the paths are visited. That walk is here, in words about
 * the document and nothing else, so neither reader has a second one.
 */

/**
 * The verbs an operation may be spelled under, and what each one is called here.
 *
 * A lookup rather than a run of tests, and the source of truth for which keys
 * of a path item are operations at all: a path item also carries `parameters`,
 * `summary` and `$ref`, and treating one of those as a verb would invent a
 * route nobody declared.
 */
export const OPERATION_VERBS: Readonly<Record<string, string>> = {
  get: 'GET',
  put: 'PUT',
  post: 'POST',
  delete: 'DELETE',
  options: 'OPTIONS',
  head: 'HEAD',
  patch: 'PATCH',
  trace: 'ALL',
};

/** One operation of a document: the path as written, the key it is under, its verb, and the operation itself. */
export interface DeclaredOperation {
  readonly rawPath: string;
  readonly key: string;
  readonly verb: string;
  readonly operation: Readonly<Record<string, unknown>>;
}

/**
 * Every operation under a document's `paths`, paths in order and each path's
 * verbs in the order of `verbs`. A reader whose documents spell a verb of their
 * own - an extension key that stands for any verb - passes the verbs it reads.
 */
export const operationsOf = (
  paths: Readonly<Record<string, unknown>>,
  verbs: Readonly<Record<string, string>> = OPERATION_VERBS,
): DeclaredOperation[] => {
  const out: DeclaredOperation[] = [];
  for (const [rawPath, item] of Object.entries(paths).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (item === null || typeof item !== 'object') continue;
    for (const [key, verb] of Object.entries(verbs)) {
      const operation = (item as Record<string, unknown>)[key];
      if (operation === null || typeof operation !== 'object') continue;
      out.push({ rawPath, key, verb, operation: operation as Record<string, unknown> });
    }
  }
  return out;
};
