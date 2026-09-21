import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from mahaam_feedback import monitor  # noqa: E402

SEEN = {}


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers["Content-Length"])
        body = json.loads(self.rfile.read(length).decode())
        SEEN["path"], SEEN["body"] = self.path, body
        self.send_response(201)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"key": "MH-1", "status": "created"}).encode())

    def log_message(self, *a):
        pass


class MonitorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "127.0.0.1:%d" % cls.srv.server_port

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def test_disabled_without_dsn(self):
        cfg = monitor.MonitorConfig(dsn="").resolved()
        self.assertFalse(cfg.active)
        # must not raise, and must not attempt a request
        monitor.capture(message="x", cfg=cfg)

    def test_invalid_dsn_disables_rather_than_raises(self):
        for bad in ["not a url", "https://m.test/monitor/p1", "https://key@m.test/"]:
            cfg = monitor.MonitorConfig(dsn=bad).resolved()
            self.assertFalse(cfg.active, bad)

    def test_dsn_parsing_with_port(self):
        cfg = monitor.MonitorConfig(dsn="http://mdsn_x@127.0.0.1:9999/monitor/p1").resolved()
        self.assertEqual(cfg.parsed["ingest_url"], "http://127.0.0.1:9999/api/monitor/p1/envelope")
        self.assertEqual(cfg.parsed["public_key"], "mdsn_x")

    def test_capture_posts_the_envelope(self):
        cfg = monitor.MonitorConfig(
            dsn="http://mdsn_test@%s/monitor/proj-1" % self.base, environment="test",
        ).resolved()
        monitor.capture(type="ValueError", value="boom", level="fatal", cfg=cfg)
        self.assertEqual(SEEN["path"], "/api/monitor/proj-1/envelope")
        self.assertEqual(SEEN["body"]["public_key"], "mdsn_test")
        self.assertEqual(SEEN["body"]["exception_type"], "ValueError")
        self.assertEqual(SEEN["body"]["level"], "fatal")
        self.assertEqual(SEEN["body"]["environment"], "test")

    def test_capture_exception_never_raises_on_a_dead_server(self):
        cfg = monitor.MonitorConfig(dsn="http://mdsn_x@127.0.0.1:1/monitor/p1").resolved()
        try:
            monitor.capture_exception(RuntimeError("x"), cfg=cfg)
        except Exception as e:  # pragma: no cover - the point of the test is that this doesn't happen
            self.fail("capture_exception raised: %r" % e)


if __name__ == "__main__":
    unittest.main()
