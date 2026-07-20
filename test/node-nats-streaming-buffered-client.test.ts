import ava from 'ava';
import { NatsBufferedClient } from '../src/node-nats-streaming-buffered-client';

/**
 * Library test
 */
ava( 'NatsBufferedClient is instantiable', ( test ) =>
{
  test.assert( new NatsBufferedClient() instanceof NatsBufferedClient );
} );

ava( 'NatsBufferedClient is instantiable with options', ( test ) =>
{
  const client = new NatsBufferedClient( { bufferSize: 100, batchSize: 5 } );
  test.assert( client instanceof NatsBufferedClient );
} );

ava( 'NatsBufferedClient is instantiable and can publish', async ( test ) =>
{
  const client = new NatsBufferedClient();

  test.assert( client instanceof NatsBufferedClient );
  test.assert( client.publish );
  test.assert( await client.publish( 'test', 'test' ) > 0 );
} );
