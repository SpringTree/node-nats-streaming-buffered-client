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

// Initialize a client with a buffer of 2000 messages
// The default reconnect timeout is 30s but can be changed
//
// You can instruct the client to wait for the initial connect to succeed before
// allowing any kind of publishing.
//
// You can also provide an alternate logger if you want to use something
// like bunyan. The same interface as console is asumed
//
const bufferSize = 2000;
const waitForInitialConnect = false;
const logger = console;

// NOTE: constructor parameters have changed in v0.3.0
//
const client = new NatsBufferedClient( bufferSize, waitForInitialConnect, logger );

// Connect to the NATS server
// NATS connect options: https://github.com/nats-io/node-nats#connect-options
//
const natsOptions = { ... };
client.connect( 'test-cluster', 'test', natsOptions );

// Add a message to the buffer for publishing
//
client.publish( 'my-channel', { content: 'stuff' } );

// Access to NATS Streaming client instance is available
//
const subscription = client.stan.subscribe( 'topic', ... );
```

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
