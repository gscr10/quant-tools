from __future__ import annotations

import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

from deployment_final_gate import check_slot


SHELL = '<div id="app" style="height:100px"></div>'
CONTROLS = '''<div id="app"><div class="vela-cell"><canvas></canvas></div>
<button id="vela-action-quant-favorites">Favorites</button>
<button aria-label="Indicators">Indicators</button></div>'''


class DeploymentContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def inspect(self, html, resources=None):
        resources = resources or {}

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                if self.path == '/quant':
                    self.send_response(301)
                    self.send_header('Location', '/quant/')
                    self.end_headers()
                    return
                if self.path in ('/quant', '/quant/'):
                    body = html
                    status = 200
                    content_type = 'text/html'
                    cache = 'no-cache, no-store, must-revalidate'
                else:
                    body = resources.get(self.path, '')
                    status = 200 if self.path in resources else 404
                    content_type = 'text/javascript'
                    cache = 'public, max-age=31536000, immutable'
                self.send_response(status)
                self.send_header('Content-Type', content_type)
                self.send_header('Cache-Control', cache)
                self.end_headers()
                self.wfile.write(body.encode())

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        page = self.browser.new_page()
        page.set_default_timeout(800)
        try:
            return check_slot(page, f'http://127.0.0.1:{server.server_port}/quant', 'test')
        finally:
            page.close()
            server.shutdown()
            server.server_close()
            worker.join(timeout=5)

    def test_blank_shell_is_not_a_successful_deployment(self):
        with self.assertRaisesRegex(RuntimeError, 'no bundled assets'):
            self.inspect(SHELL)

    def test_missing_application_bundle_fails(self):
        with self.assertRaisesRegex(RuntimeError, 'HTTP 404'):
            self.inspect(SHELL + '<script src="./assets/app-missing.js"></script>')

    def test_subpath_resources_and_mounted_workspace_pass(self):
        result = self.inspect(
            SHELL + '<script src="./assets/app-ready.js"></script>',
            {'/quant/assets/app-ready.js': f'document.body.innerHTML = {CONTROLS!r};'},
        )
        self.assertEqual(len(result['assets']), 1)
        self.assertTrue(result['workspaceReady'])

    def test_bundle_that_never_mounts_workspace_fails(self):
        with self.assertRaisesRegex(Exception, 'vela-action-quant-favorites'):
            self.inspect(
                SHELL + '<script src="./assets/app-empty.js"></script>',
                {'/quant/assets/app-empty.js': 'window.loaded = true;'},
            )

    def test_inline_reference_subdomain_request_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'reference-site requests'):
            self.inspect(
                SHELL + '<script src="./assets/app-external.js"></script>',
                {'/quant/assets/app-external.js':
                 f'document.body.innerHTML = {CONTROLS!r};'
                 'fetch("https://api.luxalgo.com/unexpected").catch(() => {});'},
            )


if __name__ == '__main__':
    unittest.main()
