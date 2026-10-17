/**
 * A binary min-heap: the smallest item by `before` comes out first.
 *
 * The walks need a queue whose next item is the most worth expanding, not the
 * oldest (P92), and a sorted array re-sorted on every push is quadratic on the
 * graphs where the order matters most.
 */
export class MinHeap<T> {
  readonly #items: T[] = [];
  readonly #before: (a: T, b: T) => boolean;

  constructor(before: (a: T, b: T) => boolean) {
    this.#before = before;
  }

  get size(): number {
    return this.#items.length;
  }

  push(item: T): void {
    const items = this.#items;
    items.push(item);
    let at = items.length - 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (!this.#before(items[at]!, items[parent]!)) break;
      [items[at], items[parent]] = [items[parent]!, items[at]!];
      at = parent;
    }
  }

  pop(): T | undefined {
    const items = this.#items;
    const top = items[0];
    const last = items.pop();
    if (items.length === 0 || last === undefined) return top;
    items[0] = last;
    let at = 0;
    for (;;) {
      const left = 2 * at + 1;
      const right = left + 1;
      let smallest = at;
      if (left < items.length && this.#before(items[left]!, items[smallest]!)) smallest = left;
      if (right < items.length && this.#before(items[right]!, items[smallest]!)) smallest = right;
      if (smallest === at) break;
      [items[at], items[smallest]] = [items[smallest]!, items[at]!];
      at = smallest;
    }
    return top;
  }
}
