import { describe, expect, it } from "vitest";
import { readSse, SseParser } from "../sse";
import { toLiveEvent } from "../client";

describe("SseParser", () => {
  it("parses the API's framing (retry, named events, JSON data)", () => {
    const p = new SseParser();
    const evs = p.push('retry: 3000\n\nevent: timer.state\ndata: {"running":null}\n\n');
    expect(p.retry).toBe(3000);
    expect(evs).toEqual([{ event: "timer.state", data: '{"running":null}' }]);
  });

  it("buffers events split across chunks, including a split CRLF", () => {
    const p = new SseParser();
    expect(p.push("event: timer.sta")).toEqual([]);
    expect(p.push('rted\r\ndata: {"id":"a"}\r')).toEqual([]);
    expect(p.push("\n\r")).toEqual([]);
    expect(p.push("\n")).toEqual([{ event: "timer.started", data: '{"id":"a"}' }]);
  });

  it("joins multi-line data, ignores comments, strips one leading space, defaults the name", () => {
    const p = new SseParser();
    const evs = p.push(": keep-alive\ndata:a\ndata:  b\nid: 7\n\n");
    expect(evs).toEqual([{ event: "message", data: "a\n b", id: "7" }]);
  });

  it("drops blocks without data and an unterminated tail", () => {
    const p = new SseParser();
    expect(p.push("event: x\n\nevent: y\ndata: 1")).toEqual([]);
    expect(p.end()).toEqual([]);
  });

  it("strips a leading BOM and handles bare CR line endings", () => {
    const p = new SseParser();
    expect(p.push("﻿data: hi\r\rdata: x\r")).toEqual([{ event: "message", data: "hi" }]);
  });

  it("reads a byte stream with multi-byte characters split across chunks", async () => {
    const bytes = new TextEncoder().encode('event: timer.started\ndata: {"description":"مرحبا"}\n\n');
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 40));
        c.enqueue(bytes.slice(40));
        c.close();
      },
    });
    const out = [];
    for await (const ev of readSse(body)) out.push(ev);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0]!.data).description).toBe("مرحبا");
  });
});

describe("toLiveEvent", () => {
  it("maps timer and notification events", () => {
    expect(toLiveEvent("timer.state", '{"running":null}')).toEqual({ type: "timer.state", running: null });
    expect(toLiveEvent("timer.started", '{"id":"e1"}')).toMatchObject({ type: "timer.started", entry: { id: "e1" } });
    expect(toLiveEvent("timer.stopped", '{"id":"e1"}')).toMatchObject({ type: "timer.stopped" });
    expect(toLiveEvent("notification.created", "{}")).toMatchObject({ type: "notification", name: "notification.created" });
    expect(toLiveEvent("weird", "not json")).toEqual({ type: "other", name: "weird", data: "not json" });
  });
});
