const NatsBufferedClient = require( '../dist/node-nats-streaming-buffered-client' ).NatsBufferedClient;

// Use a buffersize of 3000 and reconnect time of 5s
// We will instruct the client to not wait for initial connect which
// allows us to publish even before connecting
//
const client = new NatsBufferedClient( 3000, false, console );

const clusterName = 'test-cluster';
const queueName = 'test-channel';
const clientName = 'demo';
const clientGroupName = 'demo-clients';

let durableSub;

// We can publish before connecting
//
client.publish( queueName, 'pre-connect' );

// Connect to localhost nats streaming server
// For persistence testing create a volume first: docker create volume local-nats-streaming
// Can run with: docker run -p 4222:4222 -p 8222:8222 --mount source=local-nats-streaming,target=/opt/stan -ti nats-streaming -m 8222 -cid test-cluster -store file -dir /opt/stan
// Just ctrl+c the docker to test the server being unavailable and start it up again to resume
//
const opts = { servers: [ 'nats://localhost:4222' ] };
client.connect( clusterName, clientName, opts )
.then( () =>
{
  console.log( '[TEST] Connected to NATS' );

  // We'll setup a durable subscription as an echo test for our published messages
  //
  const opts = client.stan.subscriptionOptions();
  opts.setDeliverAllAvailable();
  opts.setDurableName( 'test-sub' );

  // Rate limit so we might still be able to read the logging
  //
  opts.setMaxInFlight( 1 );

  // Set manual akcnowledgement
  // WARNING: Only set ack wait to whole seconds as the client library
  // has a number handling issue
  //
  opts.setAckWait( 1000 );
  opts.setManualAckMode( true );

  // Create our durable subscription
  //
  console.log( '[TEST] Setup durable subscription', queueName, clientGroupName, opts );
  durableSub = client.stan.subscribe( queueName, clientGroupName, opts );

  durableSub.on( 'ready', () =>
  {
    console.log( '[SUB] Ready!' );
  } );

  durableSub.on( 'message', ( msg ) =>
  {
    console.log( '[SUB] Received message', msg.getData() );
    msg.ack();
  } );

  durableSub.on( 'error', ( error ) =>
  {
    console.log( '[SUB] Error', error );
  } );

  durableSub.on( 'timeout', ( error ) =>
  {
    console.log( '[SUB] Timeout', error );
  } );

  durableSub.on( 'unsubscribed', () =>
  {
    console.log( '[SUB] Closed' );
  } );

} )
.catch( ( error ) =>
{
  console.error( '[TEST] Failed to connect', error );
} );

client.publish( queueName, 'post-connect' );

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
  if ( durableSub ) {
    durableSub.close();
  }
} );

process.on( 'exit', () =>
{
  clearInterval( interval );
} );
