const NatsBufferedClient = require( '../dist/node-nats-streaming-buffered-client' ).NatsBufferedClient;

// Use a buffersize of 3000 and reconnect time of 5s
// We will instruct the client to not wait for initial connect which
// allows us to publish even before connecting
//
const client = new NatsBufferedClient( 3000, 5000, false );

// We can publish before connecting
//
client.publish( 'test-channel', 'pre-connect' );

// Connect to localhost nats streaming server
// Can run with: docker run -p 4222:4222 -p 8222:8222 -ti --rm nats-streaming -m 8222 -cid test-cluster
// Just ctrl+c the docker to test the server being unavailable and start it up again to resume
//
const opts = { servers: [ 'nats://localhost:4222' ] };
client.connect( 'test-cluster', 'demo', opts )
.then( () =>
{
  console.log( '[TEST] Connected to NATS' );
} )
.catch( ( error ) =>
{
  console.error( '[TEST] Failed to connect', error );
} );

client.publish( 'test-channel', 'post-connect' );

const interval = setInterval( () =>
{
  // Publish a message at a random interval of 300-1000ms
  //
  client.publish( 'test-channel', new Date().toISOString() );
}, 1000 + Math.max( 300, (Math.random() * 1000).toFixed(0) ) );

// Stop all the things when we try to quit
//
process.on( 'SIGINT', () =>
{
  clearInterval( interval );

  client.disconnect()
  .then( () =>
  {
    console.log( 'Have a nice day' );
  } );
} );

