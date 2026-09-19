import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from mahaam_feedback import Config, FeedbackError, report, script_tag  # noqa: E402

SEEN = {}


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"])).decode()
        SEEN["path"], SEEN["body"], SEEN["ctype"] = self.path, body, self.headers["Content-Type"]
        bad = "pfk_bad" in body
        self.send_response(403 if bad else 201)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"error": "origin not allowed"} if bad else {"key": "MG-12"}).encode())

    def log_message(self, *a):
        pass


class FeedbackTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_port

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def test_script_tag_escapes(self):
        c = Config(key='pfk_a"b', base_url="https://x.test/", locale="ar")
        self.assertEqual(script_tag(cfg=c),
                         '<script src="https://x.test/embed/v1.js" data-key="pfk_a&quot;b" data-locale="ar" defer></script>')
        self.assertEqual(script_tag(cfg=Config(key="k", enabled=False)), "")

    def test_report(self):
        key = report("boom", "trace", "bug", "high", cfg=Config(key="pfk_ok", base_url=self.base, app_url="https://app.test"))
        self.assertEqual(key, "MG-12")
        self.assertEqual(SEEN["path"], "/api/feedback/embed")
        self.assertTrue(SEEN["ctype"].startswith("multipart/form-data"))
        self.assertIn('name="page_url"\r\n\r\nhttps://app.test', SEEN["body"])

    def test_report_error(self):
        with self.assertRaises(FeedbackError) as ctx:
            report("x", cfg=Config(key="pfk_bad", base_url=self.base))
        self.assertEqual(ctx.exception.status, 403)


if __name__ == "__main__":
    unittest.main()
