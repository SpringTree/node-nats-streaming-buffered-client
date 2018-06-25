const NatsBufferedClient = require( '../dist/node-nats-streaming-buffered-client' ).NatsBufferedClient;

// Use a buffersize of 10 and a connect timeout of 3 seconds
//
const client = new NatsBufferedClient( 3000, 3000 );

// We can publish before connecting
//
client.publish( 'test-channel', 'pre-connect' );

// Connect to localhost nats streaming server
// Can run with: docker run -p 4222:4222 -p 8222:8222 -ti --rm nats-streaming -m 8222 -cid test-cluster
// Just ctrl+c the docker to test the server being unavailable and start it up again to resume
//
const opts = { servers: [ 'nats://localhost:4222' ] };
client.connect( 'test-cluster', 'demo', opts );

client.publish( 'test-channel', 'post-connect' );

const interval = setInterval( () =>
{
  // Publish a message every second
  //
  client.publish( 'test-channel', new Date().toISOString() );
}, Math.max( 300, (Math.random() * 1000).toFixed(0) ) );

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

