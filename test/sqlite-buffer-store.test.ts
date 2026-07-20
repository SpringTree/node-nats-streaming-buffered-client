import ava from 'ava';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteBufferStore } from '../src/sqlite-buffer-store';

const testDir = fs.mkdtempSync( path.join( os.tmpdir(), 'sqlite-buffer-store-' ) );
let dbCounter = 0;

function freshDbPath(): string
{
  dbCounter++;
  return path.join( testDir, `test-${dbCounter}.db` );
}

ava( 'add resolves with an id and loadAll round-trips the item', async ( test ) =>
{
  const store = new SqliteBufferStore( freshDbPath() );

  const id = await store.add( { subject: 'my-channel', data: { content: 'stuff' } } );
  test.true( typeof id === 'number' );

  const items = await store.loadAll();
  test.is( items.length, 1 );
  test.is( items[ 0 ].id, id );
  test.is( items[ 0 ].subject, 'my-channel' );
  test.deepEqual( items[ 0 ].data, { content: 'stuff' } );
} );

ava( 'loadAll returns items in insertion order', async ( test ) =>
{
  const store = new SqliteBufferStore( freshDbPath() );

  await store.add( { subject: 'a', data: 1 } );
  await store.add( { subject: 'b', data: 2 } );
  await store.add( { subject: 'c', data: 3 } );

  const items = await store.loadAll();
  test.deepEqual( items.map( ( item ) => item.subject ), [ 'a', 'b', 'c' ] );
} );

ava( 'remove deletes an item so loadAll no longer returns it', async ( test ) =>
{
  const store = new SqliteBufferStore( freshDbPath() );

  const keepId   = await store.add( { subject: 'keep', data: 'kept' } );
  const removeId = await store.add( { subject: 'remove', data: 'removed' } );

  await store.remove( removeId );

  const items = await store.loadAll();
  test.is( items.length, 1 );
  test.is( items[ 0 ].id, keepId );
} );

ava( 'items survive a restart: a new store instance on the same file loads them', async ( test ) =>
{
  const dbPath = freshDbPath();

  const firstInstance = new SqliteBufferStore( dbPath );
  await firstInstance.add( { subject: 'a', data: { seq: 1 } } );
  await firstInstance.add( { subject: 'b', data: { seq: 2 } } );

  // Simulate a crash: no close(), just drop the instance and re-open
  //
  const secondInstance = new SqliteBufferStore( dbPath );
  const items          = await secondInstance.loadAll();

  test.is( items.length, 2 );
  test.deepEqual( items.map( ( item ) => item.data ), [ { seq: 1 }, { seq: 2 } ] );
} );

ava( 'close releases the database handle', async ( test ) =>
{
  const store = new SqliteBufferStore( freshDbPath() );
  await store.add( { subject: 'a', data: 1 } );
  store.close();

  await test.throwsAsync( () => store.add( { subject: 'b', data: 2 } ) );
} );

ava( 'payloads keep their JSON type through a round-trip', async ( test ) =>
{
  const store = new SqliteBufferStore( freshDbPath() );

  // The NUMERIC affinity trap: a numeric-looking string must come back
  // as a string, a number as a number
  //
  await store.add( { subject: 's', data: '123' } );
  await store.add( { subject: 'n', data: 123 } );
  await store.add( { subject: 'f', data: 1.5 } );
  await store.add( { subject: 'u', data: 'snøstorm ❄️' } );
  await store.add( { subject: 'o', data: { nested: { deep: [ 1, 'two', null, true ] } } } );

  const items = await store.loadAll();

  test.is( items[ 0 ].data, '123' );
  test.is( items[ 1 ].data, 123 );
  test.is( items[ 2 ].data, 1.5 );
  test.is( items[ 3 ].data, 'snøstorm ❄️' );
  test.deepEqual( items[ 4 ].data, { nested: { deep: [ 1, 'two', null, true ] } } );
} );

ava( 'the data column stores payloads with TEXT affinity, not NUMERIC', async ( test ) =>
{
  const dbPath = freshDbPath();
  const store  = new SqliteBufferStore( dbPath );

  await store.add( { subject: 'numeric-looking-string', data: '123' } );
  await store.add( { subject: 'number', data: 123 } );

  // Bypass SqliteBufferStore's JSON.parse and inspect SQLite's own storage
  // class directly. If the data column ever regressed from TEXT to JSON
  // (NUMERIC affinity), SQLite would store these differently at this level
  // even though JSON.parse() on the way out would normalize both back to
  // the same JS values, masking the regression from the round-trip test
  //
  // tslint:disable-next-line:no-var-requires no-require-imports
  const Database = require( 'better-sqlite3' );
  const raw       = new Database( dbPath, { readonly: true } );
  const rows      = raw.prepare( 'SELECT subject, typeof( data ) as dataType FROM messages ORDER BY id' ).all();
  raw.close();

  test.deepEqual(
    rows.map( ( row: any ) => ( { subject: row.subject, dataType: row.dataType } ) ),
    [
      { subject: 'numeric-looking-string', dataType: 'text' },
      { subject: 'number', dataType: 'text' },
    ],
  );
} );

ava( 'add rejects unserializable payloads and stores nothing', async ( test ) =>
{
  const store = new SqliteBufferStore( freshDbPath() );

  // Circular reference: JSON.stringify throws
  //
  const circular: any = {};
  circular.self       = circular;
  await test.throwsAsync( () => store.add( { subject: 'c', data: circular } ) );

  // undefined: JSON.stringify returns undefined without throwing
  //
  await test.throwsAsync( () => store.add( { subject: 'u', data: undefined } ) );

  const items = await store.loadAll();
  test.is( items.length, 0 );
} );
