# NATS Streaming Buffered Client

[![Travis](https://img.shields.io/travis/springtree/node-nats-streaming-buffered-client.svg)](https://travis-ci.org/springtree/node-nats-streaming-buffered-client)

This is a client for the NATS streaming server built for clients that may have an intermittent connection to the server.
The need for this client arose for IoT devices with 4G connections and to ensure no messages are lost on server upgrades, reboots or mishaps.

## Usage

```bash
npm install node-nats-streaming-buffered-client
```

## Features

- Reconnect logic
- Ring buffer to store messages to publish
- Retry to publish messages

## Importing library

You can import the generated bundle to use the whole library generated by this starter:

```javascript
import { NatsBufferedClient } from 'node-nats-streaming-buffered-client'

// Initialize a client with a buffer of 2000 messages
//
const client = new NatsBufferedClient( 2000 );

// Connect to the NATS server
//
client.connect( 'test-cluster', 'test' );

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
