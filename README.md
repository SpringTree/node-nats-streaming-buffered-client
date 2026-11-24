# NATS Streaming Buffered Client

[![npm version](https://badge.fury.io/js/node-nats-streaming-buffered-client.svg)](https://badge.fury.io/js/node-nats-streaming-buffered-client)
[![CI](https://github.com/SpringTree/node-nats-streaming-buffered-client/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/SpringTree/node-nats-streaming-buffered-client/actions/workflows/ci.yml)

This is a client for the NATS streaming server built for clients that may have an intermittent connection to the server.
The need for this client arose for IoT devices with 4G connections and to ensure no messages are lost on server upgrades, reboots or mishaps.

Note that NATS Streaming (STAN) and its [node client](https://github.com/nats-io/stan.js) are deprecated upstream in favour of NATS JetStream.

## Features

- Reconnect logic
- Ring buffer to store messages to publish
- Retry to publish messages

## Usage

```bash
npm install node-nats-streaming-buffered-client node-nats-streaming
```

The package is ESM only and requires Node.js 22 or later. `node-nats-streaming` (0.2 or 0.3) is a peer dependency.

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
// like bunyan. Any object with console style debug, log, warn and error methods works
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
The lower level nats layer will reconnect when a connection is restored but publishing will fail because the client is not known on the server.
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

## Development

```bash
# Install dependencies
bun install
```

Scripts:

- `bun run build`: build the ESM bundle and type declarations into `dist` with bunup
- `bun run type-check`: type-check with TypeScript
- `bun run lint` / `bun run lint:fix`: lint with oxlint (type-aware)
- `bun run fmt` / `bun run fmt:fix`: check or fix formatting with oxfmt
- `bun run test`: run the tests

`test/client-demo.js` is a manual demo against a local NATS streaming server, see the comments in the file.

### Testing

```bash
bun run test
```

Every test run reports coverage and fails when a source file drops below 90% of its lines or functions, see `bunfig.toml`.
The tests do not need a NATS server. They replace `node-nats-streaming` with the fake connection in `test/helpers/fake-stan.ts`.

### Technology stack

- bun
- typescript
- node-nats-streaming

### Branch strategy and protection

The `master` branch has protection enabled against direct pushes.
All changes need to be done through a reviewed pull request.

The protection comes from the organization rulesets, enabled by this repository's custom properties:

- `conventional-pr-title`: requires the `pull-request-title / conventional` check from `pull-request-title.yml`
- `reviewer-approval-required`: requires an approving review and squash merges
- `supply-chain-gates`: requires the `supply-chain / secrets`, `licences`, `code` and `quarantine` checks from `compliance.yml`

### Supply chain

- `.npmrc` and `bunfig.toml` refuse package versions published less than 7 days ago (package quarantine)
- Pull requests run the shared [supply-chain gates](https://github.com/SpringTree/springtree-ci-workflows) (secrets, licences, code and package quarantine) from `compliance.yml`
- Pull request titles are checked as conventional commits by the shared title check in `pull-request-title.yml`
- GitHub Actions are pinned by commit SHA

## Deploying

Releases are fully handled by GitHub Actions; never publish from a laptop.

1. Squash merge pull requests into `master`. The pull request title becomes the commit and must be a [conventional commit](https://www.conventionalcommits.org), checked by `pull-request-title.yml`
2. [release-please](https://github.com/googleapis/release-please-action) opens or updates a release pull request with the version bump and changelog
3. Merging the release pull request creates the tag and GitHub release, and the release workflow publishes to npm using [trusted publishing](https://docs.npmjs.com/trusted-publishers)

One-time setup:

- GitHub: an `npm-publish` environment that only the `master` branch may deploy to (Settings → Environments → Deployment branches). Create it before the first release: GitHub creates a missing environment without that restriction
- npm: trusted publisher for this repository, `release.yml` and the `npm-publish` environment
- GitHub: an organization GitHub App with contents, pull requests and issues write access on this repository; its client id as the `RELEASE_APP_CLIENT_ID` repository variable and its private key as the `RELEASE_APP_PRIVATE_KEY` repository secret

## License

MIT, see [LICENSE](./LICENSE).
