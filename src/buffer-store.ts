/**
 * The type of objects we push onto our buffer
 *
 * @export
 * @interface IBufferItem
 */
export interface IBufferItem
{
  subject: string;
  data: any;

  /**
   * Store-assigned identifier. Present on items that went through a
   * persistent store
   */
  id?: number;
}

/**
 * Contract for pluggable persistent buffer storage.
 *
 * A resolved add() means the item is durably written: a crash at any
 * later moment must not lose it. A rejected add() means the item was
 * not accepted.
 *
 * NOTE for truly asynchronous implementations (the built-in
 * SqliteBufferStore is synchronous under the hood and immune): if add()
 * can commit before a concurrent loadAll() runs but resolve after it,
 * a message may be published twice (at-least-once delivery, never
 * loss), and concurrent publish() calls may enter the in-memory buffer
 * in a different order than their store ids.
 *
 * @export
 * @interface IBufferStore
 */
export interface IBufferStore
{
  /**
   * Durably persist an item. Resolves with the store-assigned id once
   * the item is safely written
   */
  add( item: IBufferItem ): Promise<number>;

  /**
   * Delete a previously added item by id
   */
  remove( id: number ): Promise<void>;

  /**
   * Return all stored items in insertion order (id ascending),
   * including their ids
   */
  loadAll(): Promise<IBufferItem[]>;
}
