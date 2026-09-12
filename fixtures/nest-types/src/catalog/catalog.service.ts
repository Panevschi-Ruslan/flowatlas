import { Injectable } from '@nestjs/common';

import { Category } from '../types/category';
import { A, B } from '../types/cycle';
import { L0 } from '../types/deep';
import { Kind, Status } from '../types/order';
import { Paginated } from '../types/paginated';
import { Shape1, Shape2 } from '../types/shapes';

@Injectable()
export class CatalogService {
  /** Self-recursive `Category` → one entry, terminates (§10). */
  categories(): Category[] {
    return [{ id: 'root', name: 'root', children: [] }];
  }

  /** Mutual recursion `A` ↔ `B` → two entries, refs by id, terminates (§10). */
  cycle(): A {
    const b: B = { code: 0, a: null };
    return { name: 'root', b };
  }

  /** `Shape1` in, `Shape2` out — same shape, different names ⇒ equal `structuralHash`. */
  shapes(first: Shape1): Shape2 {
    return first;
  }

  /** Deep chain `L0 → L1 → L2 → L3 → L4` against `types.maxDepth: 3`. */
  deep(): L0 {
    return {
      next: { next: { next: { next: { value: 'leaf' } } } },
      inline: { a: { b: { c: 'deep' } } },
    };
  }

  /** Literal-union alias in, enum out. */
  classify(kind: Kind): Status {
    return kind === 'retail' ? Status.New : Status.Paid;
  }

  // unresolved: type-generic-uninstantiated (info, `meta.level: 'info'`) — the type
  // argument is a method type parameter, unknown at this site, so the ref is
  // `type:nest-types#Paginated<T>` pointing at the bare `kind: generic` template
  // entry rather than at an instantiation (§10 / D6).
  wrap<T>(items: T[]): Paginated<T> {
    return { items, total: items.length, page: 1 };
  }
}
