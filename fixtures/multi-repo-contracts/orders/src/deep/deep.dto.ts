/**
 * Five levels, so the fifth is past the default depth.
 *
 * The caller's copy differs twice: at the top, where the walk reports it by
 * name, and at the fifth level, which is past both the walk's default cut and
 * the reach of the structural hash. At the default depth that second one is
 * reported against the shape the walk stopped at; at `--depth=6` the field
 * itself is named.
 */
export interface DeepL4 {
  leaf: string;
}

export interface DeepL3 {
  next: DeepL4;
}

export interface DeepL2 {
  next: DeepL3;
}

export interface DeepL1 {
  next: DeepL2;
}

export interface DeepDto {
  label: string;
  next: DeepL1;
}

/** A shape that contains itself. The walk has to stop; the report has to not. */
export interface CategoryDto {
  id: string;
  children: CategoryDto[];
}
