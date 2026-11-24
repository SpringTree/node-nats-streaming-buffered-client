/**
 * First in, first out buffer with a fixed capacity
 * - push() adds to the end. When full the oldest item is dropped
 * - unshift() puts an item back at the front (a failed publish). When full the newest item is dropped
 * - every dropped item is handed to the overflow callback
 *
 * Same overflow behaviour as the CBuffer package it replaces
 *
 */
export class BoundedBuffer<Item> {
  private items: Item[] = [];

  constructor(
    readonly capacity: number,
    private readonly onOverflow: (item: Item) => void,
  ) {}

  get length(): number {
    return this.items.length;
  }

  push(item: Item): void {
    if (this.items.length >= this.capacity) {
      this.drop(this.items.shift());
    }
    this.items.push(item);
  }

  unshift(item: Item): void {
    if (this.items.length >= this.capacity) {
      this.drop(this.items.pop());
    }
    this.items.unshift(item);
  }

  /**
   * Remove and return up to `count` items from the front
   *
   */
  take(count: number): Item[] {
    return this.items.splice(0, count);
  }

  private drop(item: Item | undefined): void {
    if (item !== undefined) {
      this.onOverflow(item);
    }
  }
}
