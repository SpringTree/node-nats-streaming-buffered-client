import ava from 'ava';
import { IBufferItem, IBufferStore, NatsBufferedClient } from '../src/node-nats-streaming-buffered-client';

/**
 * In-memory IBufferStore fake with failure switches and call recording
 */
class FakeStore implements IBufferStore
{
  public items       = new Map<number, IBufferItem>();
  public addCalls    = 0;
  public loadAllCalls = 0;
  public removeCalls: number[] = [];
  public failAdd     = false;
  public failLoadAll = false;
  public failRemove  = false;
  private nextId     = 1;

  public add( item: IBufferItem ): Promise<number>
  {
    this.addCalls++;
    if ( this.failAdd )
    {
      return Promise.reject( new Error( 'add failed' ) );
    }
    const id = this.nextId++;
    this.items.set( id, { subject: item.subject, data: item.data, id } );
    return Promise.resolve( id );
  }

  public remove( id: number ): Promise<void>
  {
    this.removeCalls.push( id );
    this.items.delete( id );
    if ( this.failRemove )
    {
      return Promise.reject( new Error( 'remove failed' ) );
    }
    return Promise.resolve();
  }

  public loadAll(): Promise<IBufferItem[]>
  {
    this.loadAllCalls++;
    if ( this.failLoadAll )
    {
      return Promise.reject( new Error( 'loadAll failed' ) );
    }
    return Promise.resolve( Array.from( this.items.values() ) );
  }

  /**
   * Test helper: preload an item as if a previous process stored it
   */
  public preload( subject: string, data: any ): number
  {
    const id = this.nextId++;
    this.items.set( id, { subject, data, id } );
    return id;
  }
}

/**
 * Exposes protected members for testing
 */
// tslint:disable-next-line:max-classes-per-file
class TestClient extends NatsBufferedClient
{
  public runHydrate(): Promise<void>
  {
    return this.hydrate();
  }

  public bufferContents(): IBufferItem[]
  {
    return ( this as any ).buffer.toArray();
  }
}

ava( 'publish resolves after the store write and the item carries its id', async ( test ) =>
{
  const store  = new FakeStore();
  const client = new TestClient( { bufferSize: 10, store } );

  const length = await client.publish( 'my-channel', { content: 'stuff' } );

  test.is( length, 1 );
  test.is( store.addCalls, 1 );
  test.is( client.count(), 1 );
  test.is( client.bufferContents()[ 0 ].id, 1 );
} );

ava( 'publish rejects and does not buffer when the store write fails', async ( test ) =>
{
  const store   = new FakeStore();
  store.failAdd = true;
  const client  = new TestClient( { bufferSize: 10, store } );

  await test.throwsAsync( () => client.publish( 'my-channel', 'data' ) );
  test.is( client.count(), 0 );
} );

ava( 'publish without a store still buffers', async ( test ) =>
{
  const client = new TestClient( { bufferSize: 10 } );

  const length = await client.publish( 'my-channel', 'data' );

  test.is( length, 1 );
  test.is( client.count(), 1 );
  test.is( client.bufferContents()[ 0 ].id, undefined );
} );

/**
 * Minimal stan stand-in whose publish always acks
 */
function ackingStan(): any
{
  return {
    publish: ( subject: string, data: any, callback: ( error?: Error ) => void ) =>
    {
      setImmediate( () => callback( undefined ) );
    },
  };
}

/**
 * Minimal stan stand-in whose publish always calls back with an error
 */
function failingStan(): any
{
  return {
    publish: ( subject: string, data: any, callback: ( error?: Error ) => void ) =>
    {
      setImmediate( () => callback( new Error( 'stan: publish ack timeout' ) ) );
    },
  };
}

function delay( ms: number ): Promise<void>
{
  return new Promise( ( resolve ) => setTimeout( resolve, ms ) );
}

ava( 'a NATS ack removes the item from the store', async ( test ) =>
{
  const store  = new FakeStore();
  const client = new TestClient( { bufferSize: 10, store } );
  client.stan  = ackingStan();

  await client.publish( 'my-channel', 'data' );
  await delay( 50 );

  test.deepEqual( store.removeCalls, [ 1 ] );
  test.is( client.count(), 0 );
  test.is( store.items.size, 0 );
} );

ava( 'ring buffer overflow removes the evicted item from the store', async ( test ) =>
{
  const store  = new FakeStore();
  const client = new TestClient( { bufferSize: 2, store } );

  await client.publish( 'a', 1 );
  await client.publish( 'b', 2 );
  await client.publish( 'c', 3 );
  await delay( 10 );

  // Oldest item (id 1) was evicted and must be gone from the store too
  //
  test.deepEqual( store.removeCalls, [ 1 ] );
  test.is( client.count(), 2 );
  test.deepEqual( client.bufferContents().map( ( item ) => item.id ), [ 2, 3 ] );
} );

ava( 'the buffer stays a ring buffer after a drain cycle (slice regression)', async ( test ) =>
{
  const store  = new FakeStore();
  const client = new TestClient( { bufferSize: 2, store } );
  client.stan  = ackingStan();

  // Drain one item through a full tick cycle
  //
  await client.publish( 'drained', 0 );
  await delay( 50 );
  test.is( client.count(), 0 );

  // Disconnect and overfill: overflow must STILL fire, which it does
  // not if tick() replaced the CBuffer with a plain array
  //
  client.stan = undefined;
  await client.publish( 'a', 1 );
  await client.publish( 'b', 2 );
  await client.publish( 'c', 3 );
  await delay( 10 );

  test.is( client.count(), 2 );
  test.is( store.removeCalls.length, 2 ); // 1 ack (id 1) + 1 overflow eviction (id 2)
} );

ava( 'hydrate prepends stored items and dedups ids already in the buffer', async ( test ) =>
{
  const store = new FakeStore();
  store.preload( 'old-1', 'a' ); // id 1
  store.preload( 'old-2', 'b' ); // id 2

  const client = new TestClient( { bufferSize: 10, store } );

  // Published before connect: in the store AND in the buffer (id 3)
  //
  await client.publish( 'new-1', 'c' );

  await client.runHydrate();

  // Old messages first, the pre-connect publish NOT duplicated
  //
  test.deepEqual( client.bufferContents().map( ( item ) => item.id ), [ 1, 2, 3 ] );
  test.is( client.count(), 3 );
} );

ava( 'hydrate drops the oldest items beyond capacity and removes them from the store', async ( test ) =>
{
  const store = new FakeStore();
  store.preload( 'old-1', 'a' ); // id 1 - oldest, must be dropped
  store.preload( 'old-2', 'b' ); // id 2
  store.preload( 'old-3', 'c' ); // id 3

  const client = new TestClient( { bufferSize: 2, store } );
  await client.runHydrate();

  test.deepEqual( client.bufferContents().map( ( item ) => item.id ), [ 2, 3 ] );
  test.deepEqual( store.removeCalls, [ 1 ] );
} );

ava( 'hydrate runs once per process', async ( test ) =>
{
  const store = new FakeStore();
  store.preload( 'old-1', 'a' );

  const client = new TestClient( { bufferSize: 10, store } );

  await client.runHydrate();
  await client.runHydrate();

  test.is( store.loadAllCalls, 1 );
  test.is( client.count(), 1 );
} );

ava( 'concurrent hydrate calls share one loadAll and do not duplicate the buffer', async ( test ) =>
{
  const store = new FakeStore();
  store.preload( 'old-1', 'a' );
  store.preload( 'old-2', 'b' );

  const client = new TestClient( { bufferSize: 10, store } );

  // Fire two hydrate calls back-to-back without awaiting the first —
  // this is the race the fix closes
  //
  const first  = client.runHydrate();
  const second = client.runHydrate();
  await Promise.all( [ first, second ] );

  test.is( store.loadAllCalls, 1 );
  test.is( client.count(), 2 );
} );

ava( 'connect rejects when hydration fails', async ( test ) =>
{
  const store       = new FakeStore();
  store.failLoadAll = true;

  const client = new TestClient( { bufferSize: 10, store } );

  // loadAll rejects before any NATS connection is attempted
  //
  await test.throwsAsync( () => client.connect( 'test-cluster', 'test-client' ) );
} );

ava( 'a failed hydrate is retried by the next connect attempt', async ( test ) =>
{
  const store       = new FakeStore();
  store.preload( 'old-1', 'a' );
  store.failLoadAll = true;

  const client = new TestClient( { bufferSize: 10, store } );

  await test.throwsAsync( () => client.connect( 'test-cluster', 'test-client' ) );

  store.failLoadAll = false;
  await client.runHydrate();

  test.is( client.count(), 1 );
} );

ava( 'a failed NATS publish requeues the item and does not remove it from the store', async ( test ) =>
{
  const store  = new FakeStore();
  const client = new TestClient( { bufferSize: 10, store } );

  // tick() retries a failed publish immediately and indefinitely (no
  // backoff), so a stan that always fails would keep re-shifting the
  // item off the buffer forever and the buffer would almost never be
  // observed in its settled "requeued" state. Disconnect after the
  // first failure so the retry loop stops and the buffer settles
  //
  client.stan = failingStan();
  const originalPublish = client.stan.publish;
  client.stan.publish = ( subject: string, data: any, callback: ( error?: Error ) => void ) =>
  {
    originalPublish( subject, data, ( error?: Error ) =>
    {
      client.stan = undefined;
      callback( error );
    } );
  };

  await client.publish( 'my-channel', 'data' );
  await delay( 50 );

  // Still buffered (requeued), still in the store (never removed)
  //
  test.is( client.count(), 1 );
  test.is( client.bufferContents()[ 0 ].id, 1 );
  test.deepEqual( store.removeCalls, [] );
} );

ava( 'a store remove failure is logged and does not block further tick processing', async ( test ) =>
{
  const store      = new FakeStore();
  store.failRemove = true;

  const silentLogger = { log: () => undefined, warn: () => undefined, error: () => undefined };
  const client       = new TestClient( { bufferSize: 10, store, logger: silentLogger } );
  client.stan        = ackingStan();

  await client.publish( 'a', 1 );
  await delay( 50 );

  // The ack still removed the item from the in-memory buffer even
  // though store.remove() rejected — the rejection was swallowed
  //
  test.is( client.count(), 0 );

  // tick() kept working afterward — a second publish still drains
  //
  await client.publish( 'b', 2 );
  await delay( 50 );
  test.is( client.count(), 0 );
} );
