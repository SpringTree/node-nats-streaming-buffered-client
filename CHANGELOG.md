# Changelog

## [2.0.0](https://github.com/SpringTree/node-nats-streaming-buffered-client/compare/v1.6.0...v2.0.0) (2026-11-26)


### ⚠ BREAKING CHANGES

* the package is ESM only, require() is no longer supported, and needs Node.js 22 or later

### Features

* **deps:** accept node-nats-streaming 0.3 as peer dependency ([7fbf6da](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/7fbf6da5c74d2b8d6a5f38395b449b0907392dd0))
* publish as an ES module and require node.js 22 or later ([7fbf6da](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/7fbf6da5c74d2b8d6a5f38395b449b0907392dd0))


### Bug Fixes

* **buffer:** keep the publish buffer bounded after the first publish batch ([7fbf6da](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/7fbf6da5c74d2b8d6a5f38395b449b0907392dd0))
* **client:** catch disconnect errors in the SIGINT handler ([7fbf6da](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/7fbf6da5c74d2b8d6a5f38395b449b0907392dd0))
* **deps:** replace CBuffer with a built-in bounded buffer ([7fbf6da](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/7fbf6da5c74d2b8d6a5f38395b449b0907392dd0))
* **types:** accept any console style logger ([7fbf6da](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/7fbf6da5c74d2b8d6a5f38395b449b0907392dd0))
