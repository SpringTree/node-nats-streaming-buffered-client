# NATS Streaming Buffered Client

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
const reconnectTimeout = 30000;
const waitForInitialConnect = false;
const logger = console;
const client = new NatsBufferedClient( bufferSize, reconnectTimeout, waitForInitialConnect, logger );

// Connect to the NATS server
// NATS connect options: https://github.com/nats-io/node-nats#connect-options
//
const natsOptions = { ... };
client.connect( 'test-cluster', 'test', natsOptions );

// Add a message to the buffer for publishing
//
client.publish( 'my-channel', { content: 'stuff' } );

// Access to NATS client instance is available
//
const subsription = client.stan.subscribe( 'topic', ... );
```

## NPM scripts

- `npm run test`: Run test suite
- `npm run build`: Generate bundles and typings, create docs
