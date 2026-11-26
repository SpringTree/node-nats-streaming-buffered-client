# Changelog

## [2.0.0](https://github.com/SpringTree/node-nats-streaming-buffered-client/compare/v1.6.0...v2.0.0) (2026-11-26)


### ⚠ BREAKING CHANGES

* the package is ESM only, require() is no longer supported, and needs Node.js 22 or later

### Features

* **client:** added wait for initital connect mode ([3da45e4](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/3da45e468a72b3bff07ad31cb7e70bb597eb7ba6))
* **deps:** accept node-nats-streaming 0.3 as peer dependency ([7fbf6da](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/7fbf6da5c74d2b8d6a5f38395b449b0907392dd0))
* **init:** Initial commit and scaffolding ([f7569af](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/f7569af1a5a9e73d9a6ed79b501c0146ff173ab4))
* **nats:** log new connection_lost event ([4e25300](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/4e253009bcc68c1386d929d75552393d6345b0b1))
* **nats:** peer dependency version upgrade ([cd18af5](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/cd18af506cd94c4ba1a2adb8e18c2d53bd65c2cc))
* publish as an ES module and require node.js 22 or later ([7fbf6da](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/7fbf6da5c74d2b8d6a5f38395b449b0907392dd0))
* **publish:** batch based publishing ([7d71d38](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/7d71d38f53fc63544fbafee295a38cb64355a06e))
* **reconnect:** added event emitter for subscription clients ([b6127e8](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/b6127e81ea06e8706b6a3760025fcad311c28b84))
* **reconnect:** reconnect timer support ([e8f5c45](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/e8f5c4527f07f1423dd1242e85351d156d1c23bc))
* **reconnect:** rely on nats client reconnect ([432185d](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/432185d0d8e6f76ac11b82d4d7878ffc1171e7f3))


### Bug Fixes

* **buffer:** keep the publish buffer bounded after the first publish batch ([7fbf6da](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/7fbf6da5c74d2b8d6a5f38395b449b0907392dd0))
* **buffer:** log sizes on startup ([9eb5372](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/9eb5372c3adb69547843c6bad40bb9970b25f525))
* **buffer:** use batch size correctly ([e79baed](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/e79baedf9d6885b186a25730a6b534e4f13d3e09))
* **client:** catch disconnect errors in the SIGINT handler ([7fbf6da](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/7fbf6da5c74d2b8d6a5f38395b449b0907392dd0))
* **client:** Connect retry on unavailble server at start ([a744ae6](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/a744ae6cef0b6bd324bb8262a085f0f71d997de5))
* **client:** Disconnect on exit ([97c3d49](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/97c3d496af76cb8ad3226d241580caf3556ec37e))
* **client:** Export for cjs ([59f1ed1](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/59f1ed158106fc0af3f7c16a365951ea3fff3f4f))
* **client:** expose buffer size and utilisation ([00350c3](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/00350c379213da9271496dac1c46c40740e37b2e))
* **client:** Extra connection checks ([8d63062](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/8d63062c99e6de863a25a2fae76463502e6c553b))
* **client:** Force exit on sigint ([a687f62](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/a687f62e14bcb3dcfdf14674129a2497b9ca64ca))
* **client:** Import and smaller default size ([0090795](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/0090795c0607ba94c0a6de32ae4e457cc0b3f697))
* **client:** Removed obsolete connectTimeout ([559d5c1](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/559d5c1c25b086ce025e0fc2933aee0e1b887693))
* **client:** Removed timers ([497e236](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/497e236fa1480ee14a253f0c4a03199953e557fa))
* **deps:** replace CBuffer with a built-in bounded buffer ([7fbf6da](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/7fbf6da5c74d2b8d6a5f38395b449b0907392dd0))
* **disconnect:** listen to correct nats event ([4fd28a9](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/4fd28a9f7084ed5b9a7a88a438eb381294ac3f55))
* **exit:** stop timer on SIGINT ([47b0f60](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/47b0f60df65d4abd92acd543ba32e39d2c56d040))
* **logger:** added wrapper for safe access ([0ee3380](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/0ee3380c6fa1aff9495685a647d2c68626a418f8))
* **logger:** allowing customer logger to be supplied ([5f5304a](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/5f5304ae76fc81d5e30b330e2c7f96276d1bd3fd))
* **logger:** use provided logger instead of console ([df6bcc8](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/df6bcc838ca132414776654e160dfdad54914bd5))
* **logging:** added 2 extra events ([ec94d39](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/ec94d39b4cc64d7f4e919d0c6e8a6b4224882047))
* **logging:** also log utilisation on error ([6f8c79e](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/6f8c79ef4e45bd89655aa353f26c5bc900011155))
* **logging:** prefer console.debug ([7ef7361](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/7ef7361ded71c56bce138dc7717793f2e3141449))
* **logging:** use apply for scope issues ([a597657](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/a59765719a4d9ba685ab14da7d11165533363db7))
* **nats:** error during reconect and delayed retry ([caade1c](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/caade1cd5365f886a1ea0bbc171828b4922614ec))
* **nats:** handle string errros from server ([f34e421](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/f34e421121f029d3ce0fff66d2f3878b59720b8c))
* **nats:** logging all the nats connection events ([4b14f7e](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/4b14f7e242c10a28fb83348921629635721cfc10))
* **nats:** unpinned node-nats-streaming version ([f889a68](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/f889a68e42d34b6a039b4fb7d828b22ffe56a092))
* **npm:** audit fixes ([eb0731a](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/eb0731ac9d548624663df3eb969868d54c20d071))
* **publish:** dont stringify thats up to the client ([376d79a](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/376d79a7f769107e5a0ff79567b93b540cd921af))
* **reconnect:** force reconnect for client-desync ([2c71b4f](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/2c71b4f3b4570ecde72126bfe90a5871be4ee595))
* **travis:** disable cache because it keeps breaking ([19cbcbe](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/19cbcbe42b0e62a38dde568da09ee483ed744a58))
* **tsc:** error typing ([518de3b](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/518de3b0bf684a249462f35da3f7573f125ebe11))
* **types:** accept any console style logger ([7fbf6da](https://github.com/SpringTree/node-nats-streaming-buffered-client/commit/7fbf6da5c74d2b8d6a5f38395b449b0907392dd0))
