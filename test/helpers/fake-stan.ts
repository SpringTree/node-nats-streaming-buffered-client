import { EventEmitter } from "node:events";
import { Console } from "node:console";
import { Writable } from "node:stream";

/**
 * Stand-in for the `node-nats-streaming` module so tests never open a network connection.
 * - `connect()` returns a FakeStan and records the arguments in `connections`
 * - each FakeStan emits `connect` (or `error`) on the next tick, taken from `connectOutcomes`
 * - each publish takes its result from `publishResults`: undefined is an acknowledged publish,
 *   an Error or string is a failed one (the server reports some errors as plain strings)
 *
 * Usage: `mock.module("node-nats-streaming", () => fakeNats)` before importing the client
 *
 */

export type PublishResult = Error | string | undefined;
export type ConnectOutcome = "connect" | "error";

export interface PublishedMessage {
  data: string;
  subject: string;
}

export class FakeStan extends EventEmitter {
  closed = false;
  published: PublishedMessage[] = [];

  publish(subject: string, data: string, callback: (error: PublishResult) => void): string {
    const result = fakeNats.publishResults.shift();
    setTimeout(() => {
      if (result === undefined) {
        this.published.push({ data, subject });
      }
      callback(result);
    }, 0);
    return "guid";
  }

  close(): void {
    this.closed = true;
    setTimeout(() => this.emit("close"), 0);
  }
}

export interface FakeConnection {
  clientId: string;
  clusterId: string;
  options: object | undefined;
  stan: FakeStan;
}

export const fakeNats = {
  connectOutcomes: [] as ConnectOutcome[],
  connections: [] as FakeConnection[],
  publishResults: [] as PublishResult[],

  connect(clusterId: string, clientId: string, options?: object): FakeStan {
    const stan = new FakeStan();
    const outcome = fakeNats.connectOutcomes.shift() ?? "connect";
    fakeNats.connections.push({ clientId, clusterId, options, stan });
    setTimeout(() => {
      if (outcome === "connect") {
        stan.emit("connect");
      } else {
        stan.emit("error", new Error("fake connect failure"));
      }
    }, 0);
    return stan;
  },

  reset(): void {
    fakeNats.connectOutcomes = [];
    fakeNats.connections = [];
    fakeNats.publishResults = [];
  },
};

/**
 * A real Console whose output is captured in `lines` instead of written to the terminal
 *
 */
export function createRecordingLogger(): { lines: string[]; logger: Console } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { lines, logger: new Console({ stderr: stream, stdout: stream }) };
}

/**
 * Poll until the predicate holds. Fails after the timeout so a broken flow does not hang
 *
 */
export async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
