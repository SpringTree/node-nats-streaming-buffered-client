import { IBufferItem, IBufferStore } from './buffer-store';

/**
 * Minimal typings for the parts of better-sqlite3 we use.
 * We deliberately avoid @types/better-sqlite3 to keep the dependency
 * optional and compatible with this project's TypeScript version
 */
interface ISqliteStatement
{
  run( ...params: any[] ): { lastInsertRowid: number | bigint };
  all( ...params: any[] ): any[];
}

interface ISqliteDatabase
{
  prepare( sql: string ): ISqliteStatement;
  exec( sql: string ): void;
  close(): void;
}

/**
 * IBufferStore implementation persisting messages to a SQLite database.
 * Requires the optional peer dependency better-sqlite3 to be installed.
 * When running under Bun the built-in bun:sqlite driver is used instead
 * and better-sqlite3 is not needed.
 * Payloads must be strings or JSON-serializable values; Buffer payloads
 * are not supported
 *
 * @export
 * @class SqliteBufferStore
 */
export class SqliteBufferStore implements IBufferStore
{
  /**
   * The better-sqlite3 database handle
   *
   * @private
   * @memberof SqliteBufferStore
   */
  private db: ISqliteDatabase;

  /**
   * Prepared statements
   *
   * @private
   * @memberof SqliteBufferStore
   */
  private insertStatement: ISqliteStatement;
  private deleteStatement: ISqliteStatement;
  private selectStatement: ISqliteStatement;

  /**
   * Creates an instance of SqliteBufferStore
   *
   * @param {string} dbPath Path to the database file. Put this on a
   *                        volume mount when running in docker
   * @memberof SqliteBufferStore
   */
  constructor( dbPath: string )
  {
    // Lazily require the SQLite driver so better-sqlite3 remains an
    // optional peer dependency: only consumers instantiating this store
    // need it. Bun cannot load the better-sqlite3 native bindings so we
    // use its built-in driver, which shares the API subset we rely on
    //
    if ( ( process.versions as any ).bun )
    {
      // tslint:disable-next-line:no-var-requires no-require-imports
      const { Database } = require( 'bun:sqlite' );
      this.db = new Database( dbPath, { create: true } );
    }
    else
    {
      // tslint:disable-next-line:no-var-requires no-require-imports
      const Database = require( 'better-sqlite3' );
      this.db = new Database( dbPath );
    }

    // WAL survives process/container crashes at ~0.1-1ms per write.
    // Only an OS/power crash can lose the last moments
    //
    this.db.exec( 'PRAGMA journal_mode = WAL;' );
    this.db.exec( 'PRAGMA synchronous = NORMAL;' );

    // NOTE: data is declared TEXT on purpose. A JSON declaration would
    // get NUMERIC affinity and corrupt numeric-looking strings.
    // created_at is informational only (for ops inspecting the file)
    //
    this.db.exec( `
      CREATE TABLE IF NOT EXISTS messages (
        id         INTEGER PRIMARY KEY,
        subject    TEXT NOT NULL,
        data       TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    ` );

    this.insertStatement = this.db.prepare( 'INSERT INTO messages ( subject, data ) VALUES ( ?, ? )' );
    this.deleteStatement = this.db.prepare( 'DELETE FROM messages WHERE id = ?' );
    this.selectStatement = this.db.prepare( 'SELECT id, subject, data FROM messages ORDER BY id' );
  }

  /**
   * Durably persist an item. Resolves with the row id once written
   *
   * @param {IBufferItem} item
   * @returns {Promise<number>}
   * @memberof SqliteBufferStore
   */
  public add( item: IBufferItem ): Promise<number>
  {
    try
    {
      const serialized = JSON.stringify( item.data );

      // JSON.stringify returns undefined (without throwing) for
      // undefined and function values. Storing that would corrupt the
      // message so we reject it
      //
      if ( typeof serialized !== 'string' )
      {
        return Promise.reject( new Error( `Cannot serialize payload for subject ${item.subject}` ) );
      }

      const result = this.insertStatement.run( item.subject, serialized );
      return Promise.resolve( Number( result.lastInsertRowid ) );
    }
    catch ( error )
    {
      return Promise.reject( error );
    }
  }

  /**
   * Delete a previously added item by id
   *
   * @param {number} id
   * @returns {Promise<void>}
   * @memberof SqliteBufferStore
   */
  public remove( id: number ): Promise<void>
  {
    try
    {
      this.deleteStatement.run( id );
      return Promise.resolve();
    }
    catch ( error )
    {
      return Promise.reject( error );
    }
  }

  /**
   * Return all stored items in insertion order including their ids
   *
   * @returns {Promise<IBufferItem[]>}
   * @memberof SqliteBufferStore
   */
  public loadAll(): Promise<IBufferItem[]>
  {
    try
    {
      const rows  = this.selectStatement.all();
      const items = rows.map( ( row: any ) =>
      {
        try
        {
          return { id: row.id, subject: row.subject, data: JSON.parse( row.data ) } as IBufferItem;
        }
        catch ( parseError )
        {
          // Include the row id so a corrupt row can be located and
          // removed by hand instead of leaving connect() opaquely broken
          //
          throw new Error( `Failed to parse stored message with id ${row.id} (subject ${row.subject}): ${( parseError as Error ).message}` );
        }
      } );
      return Promise.resolve( items );
    }
    catch ( error )
    {
      return Promise.reject( error );
    }
  }

  /**
   * Close the database handle. Optional: durability never depends on
   * closing (the WAL is checkpointed on next open)
   *
   * @memberof SqliteBufferStore
   */
  public close(): void
  {
    this.db.close();
  }
}
