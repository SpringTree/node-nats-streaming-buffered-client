import { describe, expect, test } from "bun:test";
import { BoundedBuffer } from "../src/bounded-buffer";

function createBuffer(capacity: number) {
  const dropped: string[] = [];
  const buffer = new BoundedBuffer<string>(capacity, (item) => dropped.push(item));
  return { buffer, dropped };
}

describe("BoundedBuffer", () => {
  test("successfully take items in the order they were pushed", () => {
    const { buffer } = createBuffer(5);
    buffer.push("first");
    buffer.push("second");
    buffer.push("third");

    expect(buffer.take(2)).toEqual(["first", "second"]);
    expect(buffer.length).toBe(1);
    expect(buffer.take(10)).toEqual(["third"]);
    expect(buffer.length).toBe(0);
  });

  test("successfully take nothing when the buffer is empty", () => {
    const { buffer } = createBuffer(5);

    expect(buffer.take(3)).toEqual([]);
  });

  test("successfully drop the oldest item when pushing to a full buffer", () => {
    const { buffer, dropped } = createBuffer(2);
    buffer.push("first");
    buffer.push("second");
    buffer.push("third");

    expect(dropped).toEqual(["first"]);
    expect(buffer.take(2)).toEqual(["second", "third"]);
  });

  test("successfully put an item back at the front", () => {
    const { buffer } = createBuffer(5);
    buffer.push("second");
    buffer.unshift("first");

    expect(buffer.take(2)).toEqual(["first", "second"]);
  });

  test("successfully drop the newest item when putting an item back in a full buffer", () => {
    const { buffer, dropped } = createBuffer(2);
    buffer.push("second");
    buffer.push("third");
    buffer.unshift("first");

    expect(dropped).toEqual(["third"]);
    expect(buffer.take(2)).toEqual(["first", "second"]);
  });
});
