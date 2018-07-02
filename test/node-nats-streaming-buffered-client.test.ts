import { NatsBufferedClient } from '../src/node-nats-streaming-buffered-client';

/**
 * Library test
 */
describe( 'Library test', () =>
{
  it( 'NatsBufferedClient is instantiable', () =>
  {
    expect( new NatsBufferedClient() ).toBeInstanceOf( NatsBufferedClient );
  } );

  it( 'NatsBufferedClient is instantiable with buffer size', () =>
  {
    expect( new NatsBufferedClient( 100 ) ).toBeInstanceOf( NatsBufferedClient );
  } );

  it( 'NatsBufferedClient is instantiable and can publish', () =>
  {
    const client = new NatsBufferedClient();

    expect( client ).toBeInstanceOf( NatsBufferedClient );
    expect( client.publish ).toBeDefined();
    expect( client.publish( 'test', 'test' ) ).toBeGreaterThan( 0 );
  } );
} );
