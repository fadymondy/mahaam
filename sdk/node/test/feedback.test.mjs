import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { scriptTag, report, expressMiddleware, MahaamFeedbackError } from "../dist/esm/index.js";

test("scriptTag escapes and honours enabled", () => {
  assert.equal(
    scriptTag({ baseUrl: "https://x.test/", key: 'pfk_a"b', locale: "ar" }),
    '<script src="https://x.test/embed/v1.js" data-key="pfk_a&quot;b" data-locale="ar" defer></script>',
  );
  assert.equal(scriptTag({ key: "k", enabled: false }), "");
});

test("report posts multipart to a mock intake", async () => {
  let seen = "";
  const srv = http.createServer((req, res) => {
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => {
      seen = b;
      if (b.includes("pfk_bad")) {
        res.writeHead(403, { "content-type": "application/json" }).end('{"error":"origin not allowed"}');
      } else {
        res.writeHead(201, { "content-type": "application/json" }).end('{"key":"MG-12"}');
      }
    });
  });
  await new Promise((r) => srv.listen(0, r));
  const baseUrl = `http://127.0.0.1:${srv.address().port}`;
  try {
    const key = await report({ baseUrl, key: "pfk_ok", appUrl: "https://app.test", title: "boom", type: "bug" });
    assert.equal(key, "MG-12");
    assert.match(seen, /name="page_url"\r\n\r\nhttps:\/\/app\.test/);
    await assert.rejects(report({ baseUrl, key: "pfk_bad", title: "x" }), (e) => e instanceof MahaamFeedbackError && e.status === 403);
  } finally {
    srv.close();
  }
});

test("expressMiddleware injects before </body>", () => {
  const headers = { "content-type": "text/html; charset=utf-8" };
  let out = "";
  const res = {
    getHeader: (n) => headers[n],
    setHeader: (n, v) => (headers[n] = v),
    removeHeader: (n) => delete headers[n],
    write: () => true,
    end: (c) => (out = String(c)),
  };
  expressMiddleware({ baseUrl: "https://m.test", key: "pfk_1" })({}, res, () => {});
  res.end("<body>hi</body>");
  assert.match(out, /^<body>hi<script src="https:\/\/m\.test\/embed\/v1\.js"/);
});
