import { expect, test } from "bun:test";
import { NatsBufferedClient } from "../src/node-nats-streaming-buffered-client";

test("NatsBufferedClient is instantiable", () => {
  expect(new NatsBufferedClient()).toBeInstanceOf(NatsBufferedClient);
});

test("NatsBufferedClient is instantiable with buffer size", () => {
  expect(new NatsBufferedClient(100)).toBeInstanceOf(NatsBufferedClient);
});

test("NatsBufferedClient is instantiable and can publish", () => {
  const client = new NatsBufferedClient();

  expect(client.publish("test", "test")).toBeGreaterThan(0);
});
