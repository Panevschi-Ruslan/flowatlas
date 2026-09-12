/**
 * The caller's five levels, differing at the top and at the fifth.
 *
 * At the default depth the walk stops before it reaches `leaf` and reports the
 * difference against the shape it stopped at; asked to go deeper it names the
 * field. The structural hash does not reach `leaf` either, which is why the
 * shallow difference has to be there for the walk to start at all.
 */
export interface DeepL4 {
  leaf: number;
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
  label: number;
  next: DeepL1;
}

/** The caller's copy of a shape that contains itself, with one field renamed. */
export interface CategoryDto {
  code: string;
  children: CategoryDto[];
}
