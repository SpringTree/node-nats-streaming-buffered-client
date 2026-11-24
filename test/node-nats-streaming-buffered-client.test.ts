import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createRecordingLogger, fakeNats, type FakeStan, waitFor } from "./helpers/fake-stan";

// Replace the NATS streaming module before the client imports it
await mock.module("node-nats-streaming", () => fakeNats);
const { NatsBufferedClient } = await import("../src/node-nats-streaming-buffered-client");

type ProcessListener = (...args: unknown[]) => unknown;

/**
 * Create a client with a captured logger and return the process listeners it registered
 *
 */
function createClient(
  bufferSize?: number,
  waitForInitialConnection?: boolean,
  reconnectDelay?: number,
  batchSize?: number,
) {
  const { lines, logger } = createRecordingLogger();
  const exitBefore = process.listeners("exit");
  const sigintBefore = process.listeners("SIGINT");
  const client = new NatsBufferedClient(
    bufferSize,
    waitForInitialConnection,
    logger,
    reconnectDelay,
    batchSize,
  );
  const onExit = process.listeners("exit").find((listener) => !exitBefore.includes(listener));
  const onSigint = process.listeners("SIGINT").find((listener) => !sigintBefore.includes(listener));

  // Remove the listeners again so they do not pile up over the test run
  if (onExit) process.removeListener("exit", onExit);
  if (onSigint) process.removeListener("SIGINT", onSigint);

  return {
    client,
    lines,
    onExit: onExit as ProcessListener,
    onSigint: onSigint as ProcessListener,
  };
}

function currentStan(): FakeStan {
  const connection = fakeNats.connections.at(-1);
  if (!connection) {
    throw new Error("no connection made");
  }
  return connection.stan;
}

beforeEach(() => {
  fakeNats.reset();
});

describe("construction", () => {
  test("successfully create a client with the default settings", () => {
    const { client, lines } = createClient();

    expect(client).toBeInstanceOf(NatsBufferedClient);
    expect(client.count()).toBe(0);
    expect(client.utilisation()).toBe(0);
    expect(lines.join("")).toContain("Buffer size [ 10 ]");
  });

  test("successfully log on process exit", () => {
    const { lines, onExit } = createClient();

    onExit();

    expect(lines.join("")).toContain("EXIT encountered");
  });
});

describe("publish", () => {
  test("successfully buffer messages before connecting", () => {
    const { client } = createClient(100);

    expect(client.publish("subject", "first")).toBe(1);
    expect(client.publish("subject", "second")).toBe(2);
    expect(client.count()).toBe(2);
    expect(client.utilisation()).toBe(2);
  });

  test("successfully drop the oldest message when the buffer is full", () => {
    const dropped: unknown[] = [];
    class RecordingClient extends NatsBufferedClient {
      protected override overflow(data: unknown) {
        dropped.push(data);
      }
    }
    const client = new RecordingClient(2, false, createRecordingLogger().logger);

    client.publish("subject", "first");
    client.publish("subject", "second");
    client.publish("subject", "third");

    expect(client.count()).toBe(2);
    expect(dropped).toEqual([{ data: "first", subject: "subject" }]);
  });

  test("successfully log a dropped message with the default overflow handler", () => {
    const { client, lines } = createClient(1);

    client.publish("subject", "first");
    client.publish("subject", "second");

    expect(lines.join("")).toContain("Buffer is full. Dropping data:");
  });

  test("fail publishing before the initial connection when the client waits for it", () => {
    const { client } = createClient(10, true);

    expect(() => client.publish("subject", "data")).toThrow(
      "Tried to publish before initial connection",
    );
  });
});

describe("connect", () => {
  test("successfully connect with the default reconnect options", async () => {
    const { client } = createClient();

    expect(await client.connect("cluster", "client", { url: "nats://example:4222" })).toBe(true);
    expect(fakeNats.connections[0]).toMatchObject({
      clientId: "client",
      clusterId: "cluster",
      options: {
        maxReconnectAttempts: -1,
        reconnect: true,
        url: "nats://example:4222",
        waitOnFirstConnect: true,
      },
    });
  });

  test("successfully let connect options override the defaults", async () => {
    const { client } = createClient();

    await client.connect("cluster", "client", { maxReconnectAttempts: 5 });

    expect(fakeNats.connections[0]?.options).toMatchObject({ maxReconnectAttempts: 5 });
  });

  test("successfully publish messages buffered before connecting in order", async () => {
    const { client } = createClient();
    client.publish("subject", "first");
    client.publish("subject", "second");

    await client.connect("cluster", "client");
    await waitFor(() => currentStan().published.length === 2);

    expect(currentStan().published.map((message) => message.data)).toEqual(["first", "second"]);
    expect(client.count()).toBe(0);
  });

  test("successfully publish in batches when the buffer exceeds the batch size", async () => {
    const { client } = createClient(100, false, 5000, 2);
    for (let index = 0; index < 5; index++) {
      client.publish("subject", `message ${index}`);
    }

    await client.connect("cluster", "client");
    await waitFor(() => currentStan().published.length === 5);

    expect(currentStan().published.map((message) => message.data)).toEqual([
      "message 0",
      "message 1",
      "message 2",
      "message 3",
      "message 4",
    ]);
  });

  test("successfully publish messages added after connecting", async () => {
    const { client } = createClient();
    await client.connect("cluster", "client");
    await waitFor(() => currentStan().listenerCount("connect") > 0);

    client.publish("subject", "after connect");
    await waitFor(() => currentStan().published.length === 1);

    expect(currentStan().published[0]).toEqual({ data: "after connect", subject: "subject" });
  });

  test("successfully log connection events from the server", async () => {
    const { client, lines } = createClient();
    await client.connect("cluster", "client");
    const stan = currentStan();

    stan.emit("connection_lost", new Error("lost"));
    stan.emit("reconnecting");
    stan.emit("reconnect", stan);
    stan.emit("disconnect");
    stan.emit("permission_error", new Error("denied"));
    stan.emit("error", new Error("after connect"));

    const output = lines.join("");
    expect(output).toContain("Connection was lost to server");
    expect(output).toContain("Reconnecting");
    expect(output).toContain("Reconnected");
    expect(output).toContain("Disconnected");
    expect(output).toContain("Permission error");
    expect(output).toContain("Server error");
  });

  test("fail connecting when the server reports an error before the initial connection", async () => {
    const { client } = createClient();
    fakeNats.connectOutcomes.push("error");

    expect(client.connect("cluster", "client")).rejects.toThrow("fake connect failure");
  });
});

describe("publish failures", () => {
  test("successfully retry a message when publishing fails", async () => {
    const { client, lines } = createClient();
    fakeNats.publishResults.push(new Error("temporary failure"));
    client.publish("subject", "retried");

    await client.connect("cluster", "client");
    await waitFor(() => currentStan().published.length === 1);

    expect(currentStan().published[0]?.data).toBe("retried");
    expect(lines.join("")).toContain("Publish failed");
  });

  test("successfully retry a message when the server reports an ack timeout", async () => {
    const { client, lines } = createClient();
    fakeNats.publishResults.push("stan: publish ack timeout");
    client.publish("subject", "retried");

    await client.connect("cluster", "client");
    await waitFor(() => currentStan().published.length === 1);

    expect(lines.join("")).toContain("Publish time-out detected");
  });

  test("successfully reconnect and publish when the server no longer knows the client", async () => {
    const { client } = createClient();
    const events: string[] = [];
    client.on("forced_reconnecting", () => events.push("forced_reconnecting"));
    client.on("forced_disconnected", () => events.push("forced_disconnected"));
    client.on("forced_reconnected", () => events.push("forced_reconnected"));
    fakeNats.publishResults.push(new Error("stan: invalid publish request"));
    client.publish("subject", "after reconnect");

    await client.connect("cluster", "client");
    await waitFor(() => fakeNats.connections.length === 2);
    await waitFor(() => currentStan().published.length === 1);

    expect(fakeNats.connections[0]?.stan.closed).toBe(true);
    expect(currentStan().published[0]?.data).toBe("after reconnect");
    expect(events).toEqual(["forced_reconnecting", "forced_disconnected", "forced_reconnected"]);
  });
});

describe("disconnect", () => {
  test("successfully disconnect when not connected", async () => {
    const { client } = createClient();

    expect(await client.disconnect()).toBeUndefined();
  });

  test("successfully close the connection", async () => {
    const { client } = createClient();
    await client.connect("cluster", "client");

    await client.disconnect();

    expect(currentStan().closed).toBe(true);
    expect(client.stan).toBeUndefined();
  });

  test("successfully disconnect on SIGINT", async () => {
    const { client, onSigint } = createClient();
    await client.connect("cluster", "client");

    await onSigint();

    expect(currentStan().closed).toBe(true);
  });

  test("fail disconnecting when closing the connection errors", async () => {
    const { client } = createClient();
    await client.connect("cluster", "client");
    const stan = currentStan();
    stan.close = () => {
      setTimeout(() => stan.emit("error", new Error("close failed")), 0);
    };

    expect(client.disconnect()).rejects.toThrow("close failed");
  });

  test("fail disconnecting on SIGINT and log the error", async () => {
    const { client, lines, onSigint } = createClient();
    await client.connect("cluster", "client");
    const stan = currentStan();
    stan.close = () => {
      setTimeout(() => stan.emit("error", new Error("close failed")), 0);
    };

    await onSigint();

    expect(lines.join("")).toContain("Error during SIGINT disconnect");
  });
});

describe("reconnect", () => {
  test("successfully reconnect and emit the forced reconnect events", async () => {
    const { client } = createClient();
    const reconnected: unknown[] = [];
    client.on("forced_reconnected", (stan) => reconnected.push(stan));
    await client.connect("cluster", "client", { url: "nats://example:4222" });

    const stan = await client.reconnect();

    expect(fakeNats.connections).toHaveLength(2);
    expect(fakeNats.connections[1]?.options).toMatchObject({ url: "nats://example:4222" });
    expect(Object.is(stan, currentStan())).toBe(true);
    expect(reconnected).toEqual([currentStan()]);
  });

  test("successfully reconnect when closing the old connection fails", async () => {
    const { client, lines } = createClient();
    await client.connect("cluster", "client");
    const stan = currentStan();
    stan.close = () => {
      setTimeout(() => stan.emit("error", new Error("close failed")), 0);
    };

    await client.reconnect();

    expect(fakeNats.connections).toHaveLength(2);
    expect(lines.join("")).toContain("Error during disconnect");
  });

  // After the first connection an error no longer rejects connect(), so a forced reconnect
  // waits for the NATS client's own reconnect to emit `connect` instead of retrying itself
  test("successfully reconnect when the server reports an error before accepting the connection", async () => {
    const { client, lines } = createClient();
    await client.connect("cluster", "client");
    fakeNats.connectOutcomes.push("error");

    const reconnecting = client.reconnect();
    await waitFor(() => lines.join("").includes("Server error"));
    currentStan().emit("connect");

    expect(Object.is(await reconnecting, currentStan())).toBe(true);
  });
});
