import NatsBufferedClient from "../src/node-nats-streaming-buffered-client"

/**
 * Library test
 */
describe( "Library test", () =>
{
  it( "NatsBufferedClient is instantiable", () =>
  {
    expect( new NatsBufferedClient() ).toBeInstanceOf( NatsBufferedClient )
  } )
} )
