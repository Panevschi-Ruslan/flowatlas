/** One setting an environment file writes, as written. */
export interface Written {
  readonly name: string;
  readonly raw: string;
}

/** A setting's name as environment files write one. */
const NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/**
 * The settings an environment file writes, in order, empty values left out.
 *
 * `KEY=value`, `export KEY=value`, a value in quotes, a comment after an
 * unquoted value. Nothing is expanded: a value that refers to another one is a
 * value nobody here can read, and is dropped by whoever keeps it.
 */
export const readEnvFile = (text: string): Written[] => {
  const out: Written[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^export\s+/, '');
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const equals = trimmed.indexOf('=');
    if (equals <= 0) continue;
    const name = trimmed.slice(0, equals).trim();
    if (!NAME.test(name)) continue;
    const written = trimmed.slice(equals + 1).trim();
    const quoted = /^(['"`])(.*)\1$/.exec(written);
    const raw = quoted === null ? written.replace(/(?:^|\s+)#.*$/, '').trim() : (quoted[2] ?? '');
    if (raw !== '') out.push({ name, raw });
  }
  return out;
};

/**
 * Only the names an environment file sets, for a file whose values are never
 * read. A value is looked at for one thing - whether there is one - and never
 * kept or returned.
 */
export const namesInEnvFile = (text: string): string[] => {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^export\s+/, '');
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const equals = trimmed.indexOf('=');
    if (equals <= 0) continue;
    const name = trimmed.slice(0, equals).trim();
    const set = /[^\s'"`]/.test(trimmed.slice(equals + 1).replace(/(?:^|\s+)#.*$/, ''));
    if (NAME.test(name) && set) out.push(name);
  }
  return out;
};
