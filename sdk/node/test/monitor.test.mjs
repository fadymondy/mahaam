import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Monitor, expressErrorHandler } from "../dist/esm/monitor.js";

test("a Monitor with no DSN is inert", async () => {
  const m = new Monitor({});
  assert.equal(m.enabled, false);
  await m.capture({ message: "should be a no-op" }); // must not throw
});

test("an invalid DSN is rejected, not thrown", () => {
  assert.equal(new Monitor({ dsn: "not a url" }).enabled, false);
  assert.equal(new Monitor({ dsn: "https://mcp.mahaam.app/monitor/p1" }).enabled, false); // no public key
  assert.equal(new Monitor({ dsn: "https://key@mcp.mahaam.app/" }).enabled, false); // no project
});

test("capture posts the envelope to the right ingest URL", async () => {
  let gotPath = "";
  let gotBody = null;
  const srv = http.createServer((req, res) => {
    gotPath = req.url;
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => {
      gotBody = JSON.parse(b);
      res.writeHead(201, { "content-type": "application/json" }).end('{"key":"MH-1","status":"created"}');
    });
  });
  await new Promise((r) => srv.listen(0, r));
  try {
    const m = new Monitor({ dsn: `http://mdsn_test@127.0.0.1:${srv.address().port}/monitor/proj-1`, environment: "test" });
    assert.equal(m.enabled, true);
    await m.capture({ type: "TypeError", value: "x is not a function", level: "fatal" });
    assert.equal(gotPath, "/api/monitor/proj-1/envelope");
    assert.equal(gotBody.public_key, "mdsn_test");
    assert.equal(gotBody.exception_type, "TypeError");
    assert.equal(gotBody.level, "fatal");
    assert.equal(gotBody.environment, "test");
  } finally {
    srv.close();
  }
});

test("expressErrorHandler reports then always calls next(err)", async () => {
  let captured = null;
  const m = new Monitor({ dsn: "http://key@x.test/monitor/p1" });
  m.captureException = async (err, extra) => {
    captured = { err, extra };
  };
  const handler = expressErrorHandler(m);
  let nextErr = "unset";
  handler(new Error("boom"), { method: "GET", originalUrl: "/x" }, { statusCode: 500 }, (e) => {
    nextErr = e;
  });
  // captureException is awaited internally via a floating promise; give the microtask queue a turn.
  await new Promise((r) => setImmediate(r));
  assert.equal(nextErr.message, "boom");
  assert.equal(captured.extra.route, "/x");
  assert.equal(captured.extra.method, "GET");
});
