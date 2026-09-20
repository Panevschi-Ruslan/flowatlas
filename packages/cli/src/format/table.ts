/** One column of a table: a heading and how to read a row into text. */
export interface Column<T> {
  header: string;
  value: (row: T) => string;
  align?: 'left' | 'right';
}

const pad = (text: string, width: number, align: 'left' | 'right'): string =>
  align === 'right' ? text.padStart(width) : text.padEnd(width);

/**
 * A fixed-width table, sized to what is in it.
 *
 * Deliberately plain: no borders, no colour, no wrapping. The output is read as
 * often by a person scrolling a terminal as by a script piping it somewhere,
 * and both are better served by columns that line up than by decoration.
 */
export const renderTable = <T>(rows: readonly T[], columns: readonly Column<T>[]): string[] => {
  if (rows.length === 0) return [];
  const cells = rows.map((row) => columns.map((column) => column.value(row)));
  const widths = columns.map((column, index) =>
    Math.max(column.header.length, ...cells.map((row) => (row[index] ?? '').length)),
  );

  const line = (values: readonly string[]): string =>
    values
      .map((value, index) => pad(value, widths[index] ?? 0, columns[index]?.align ?? 'left'))
      .join('  ')
      .trimEnd();

  return [line(columns.map((column) => column.header)), ...cells.map(line)];
};

/** The last line of a cut table, so nothing is ever quietly left out (I9). */
export const moreRows = (count: number): string => `… ${count} more rows`;

/**
 * A heading over one section of a table-formatted answer.
 *
 * `empty` is what the section says when it has no rows. A section that counts
 * something it deliberately does not list has more to say there than "none",
 * and this is the one place that decides how an empty section reads.
 */
export const section = (title: string, lines: readonly string[], empty = 'none'): string[] =>
  lines.length === 0 ? [`${title}: ${empty}`] : [`${title}:`, ...lines.map((line) => `  ${line}`)];
