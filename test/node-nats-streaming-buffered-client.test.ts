import ava from 'ava';
import { NatsBufferedClient } from '../src/node-nats-streaming-buffered-client';

/**
 * Library test
 */
ava( 'NatsBufferedClient is instantiable', ( test ) =>
{
  test.assert( new NatsBufferedClient() instanceof NatsBufferedClient );
} );

ava( 'NatsBufferedClient is instantiable with buffer size', ( test ) =>
{
  test.assert( new NatsBufferedClient( 100 ) instanceof NatsBufferedClient );
} );

ava( 'NatsBufferedClient is instantiable and can publish', ( test ) =>
{
  const client = new NatsBufferedClient();

  test.assert( client instanceof NatsBufferedClient );
  test.assert( client.publish );
  test.assert( client.publish( 'test', 'test' ) > 0 );
} );
