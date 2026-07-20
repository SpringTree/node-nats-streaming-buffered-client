# NATS Streaming Buffered Client

[![npm version](https://badge.fury.io/js/node-nats-streaming-buffered-client.svg)](https://badge.fury.io/js/node-nats-streaming-buffered-client)
[![Travis](https://travis-ci.com/SpringTree/node-nats-streaming-buffered-client.svg?branch=master)](https://travis-ci.com/SpringTree/node-nats-streaming-buffered-client)

This is a client for the NATS streaming server built for clients that may have an intermittent connection to the server.
The need for this client arose for IoT devices with 4G connections and to ensure no messages are lost on server upgrades, reboots or mishaps.

## Features

- Reconnect logic
- Ring buffer to store messages to publish
- Retry to publish messages

## Usage

```bash
npm install node-nats-streaming-buffered-client
```

You can import the buffered client class after installing it with npm:

```javascript
import { NatsBufferedClient } from 'node-nats-streaming-buffered-client'

// All options are optional. Defaults shown here
//
const client = new NatsBufferedClient( {
  bufferSize: 10,                  // Size of the message buffer
  waitForInitialConnection: false, // Reject publishes before the first connect
  logger: console,                 // Console-compatible logger (e.g. bunyan)
  reconnectDelay: 5000,            // Retry delay for forced reconnects (ms)
  batchSize: 10,                   // Messages published per processing tick
  store: undefined,                // Optional persistent store (see below)
} );

// Connect to the NATS server
// NATS connect options: https://github.com/nats-io/node-nats#connect-options
//
const natsOptions = { ... };
client.connect( 'test-cluster', 'test', natsOptions );

// Add a message to the buffer for publishing. publish() is async:
// a resolved promise means the message is buffered (and, when a store
// is configured, durably persisted); a rejected promise means the
// message was NOT accepted
//
await client.publish( 'my-channel', { content: 'stuff' } );

// Access to NATS Streaming client instance is available
//
const subscription = client.stan.subscribe( 'topic', ... );
```

### Surviving crashes and restarts

By default the message buffer lives in memory and is lost on a crash or
restart. Pass a persistent store to keep buffered messages safe. A
SQLite implementation ships with this package; it requires installing
the optional peer dependency [better-sqlite3](https://www.npmjs.com/package/better-sqlite3):

```bash
npm install better-sqlite3
```

When running under [Bun](https://bun.sh) the store uses Bun's built-in
`bun:sqlite` driver instead and `better-sqlite3` does not need to be
installed.

```javascript
import { NatsBufferedClient, SqliteBufferStore } from 'node-nats-streaming-buffered-client'

// Put the database file on a volume mount when running in docker so it
// survives the container
//
const store  = new SqliteBufferStore( '/data/nats-buffer.db' );
const client = new NatsBufferedClient( { bufferSize: 2000, store } );

await client.connect( 'test-cluster', 'test' );
```

Every accepted message is written to the store before `publish()`
resolves and deleted once NATS acknowledges it. On startup, `connect()`
loads any messages left over from a previous run and publishes them
first. If the store cannot be read, `connect()` rejects.

Payloads must be strings or JSON-serializable values. `Buffer` payloads
are not round-tripped correctly by the SQLite store — they get silently
JSON-serialized into a plain `{ type: 'Buffer', data: [...] }` object
instead of being preserved, so avoid publishing them when a store is
configured.

You can plug in your own storage by implementing the `IBufferStore`
interface (`add`, `remove`, `loadAll`) — a resolved `add` must mean the
item is durably written. The client never closes a store; whoever
creates it owns its lifecycle.

### Migrating from v0.x

- The constructor now takes a single options object (see above) instead
  of positional parameters.
- `publish()` returns a promise resolving with the buffer length.

There is a more complete test client [here](test/client-demo.js)

### A note on nats connect options

The reconnect logic from the nats streaming client relies on these 3 options:

```javascript
const defaultOptions = {
  maxReconnectAttempts: -1,
  reconnect: true,
  waitOnFirstConnect: true,
};
```

Be very careful when supplying your own connect options to not change these unless you know what you're doing.

### Forced reconnects and subscriptions

If the client loses connection with the nats streaming server long enough the server will decide to remove the client.
The lower level nats layer will reconnect when a connection is restored but publishing will fail becuase the client is not known on the server.
A forced reconnect will be triggered by the buffered client when this occurs.
This will re-register the client with the server and publishing will resume.

If you have also created subscriptions these will not resume receiving events because the subscription state will also have been purged on the server.
The buffered client will emit a trio of events during a forced reconnect which can be used to resubscribe.
These events are:

- forced_reconnecting
- forced_disconnected
- forced_reconnected

To prevent memory leaks be sure to call `removeAllListeners` on your old subscription(s).
The `forced_reconnected` event is a good trigger to begin resubscribing.

## NPM scripts

- `npm run test`: Run test suite
- `npm run build`: Generate bundles and typings, create docs
