/**
 * Lightweight local HTTP server for content script testing.
 * Content scripts require http/https URLs - file:// doesn't trigger injection.
 */

import http from 'http';
import path from 'path';
import fs from 'fs';

export interface TestServer {
  start: () => Promise<string>;
  stop: () => Promise<void>;
  url: (page?: string) => string;
  port: number;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// Default test pages embedded in the package
const BUILT_IN_PAGES: Record<string, string> = {
  '/test-input.html': `<!DOCTYPE html>
<html>
<head><title>Extension Test - Input Fields</title></head>
<body>
  <h1>Extension Test Page</h1>
  <div>
    <label for="text-input">Text Input:</label>
    <input id="text-input" type="text" style="width:400px;padding:8px;">
  </div>
  <div style="margin-top:16px">
    <label for="text-area">Textarea:</label>
    <textarea id="text-area" rows="5" cols="50"></textarea>
  </div>
  <div style="margin-top:16px">
    <label>ContentEditable:</label>
    <div id="content-editable" contenteditable="true"
         style="border:1px solid #ccc;min-height:100px;padding:8px;"></div>
  </div>
  <div style="margin-top:16px">
    <label for="email-input">Email Input:</label>
    <input id="email-input" type="email" style="width:400px;padding:8px;">
  </div>
  <div style="margin-top:16px">
    <label for="search-input">Search Input:</label>
    <input id="search-input" type="search" style="width:400px;padding:8px;">
  </div>
</body>
</html>`,

  '/test-rich-editor.html': `<!DOCTYPE html>
<html>
<head><title>Extension Test - Rich Editor</title></head>
<body>
  <h1>Rich Editor Test</h1>
  <div id="editor" contenteditable="true"
       style="border:1px solid #999;min-height:200px;padding:12px;font-family:sans-serif;">
    <p>Type here to test rich text expansion...</p>
  </div>
  <iframe id="iframe-editor" srcdoc='
    <html><body contenteditable="true" style="font-family:sans-serif;padding:8px;">
      <p>Iframe editor content</p>
    </body></html>
  ' style="width:100%;height:150px;border:1px solid #999;margin-top:16px;"></iframe>
</body>
</html>`,

  '/test-shadow-dom.html': `<!DOCTYPE html>
<html>
<head>
<title>Extension Test - Shadow DOM</title>
<script>
  customElements.define('test-input', class extends HTMLElement {
    constructor() {
      super();
      const shadow = this.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<input id="shadow-input" type="text" style="width:300px;padding:8px;">';
    }
  });
</script>
</head>
<body>
  <h1>Shadow DOM Test</h1>
  <test-input></test-input>
</body>
</html>`,

  '/test-blank.html': `<!DOCTYPE html>
<html>
<head><title>Blank Test Page</title></head>
<body></body>
</html>`,
};

/**
 * Create a test HTTP server that serves both built-in test pages
 * and any custom pages from a specified directory.
 */
export function createTestServer(
  options: {
    port?: number;
    customPagesDir?: string;
  } = {}
): TestServer {
  const port = options.port ?? 0; // 0 = random available port
  let server: http.Server;
  let actualPort: number;

  return {
    get port() { return actualPort; },

    start: () => new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        const urlPath = req.url?.split('?')[0] ?? '/';

        // Check built-in pages first
        if (BUILT_IN_PAGES[urlPath]) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(BUILT_IN_PAGES[urlPath]);
          return;
        }

        // Check custom pages directory (with path traversal protection)
        if (options.customPagesDir) {
          const filePath = path.resolve(options.customPagesDir, '.' + urlPath);
          const normalizedBase = path.resolve(options.customPagesDir);
          if (!filePath.startsWith(normalizedBase + path.sep) && filePath !== normalizedBase) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Forbidden');
            return;
          }
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath);
            const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(fs.readFileSync(filePath));
            return;
          }
        }

        // Default: return a simple page (so content scripts still inject)
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html><html><body><h1>Test Page: ${urlPath}</h1></body></html>`);
      });

      server.on('error', reject);
      server.listen(port, '127.0.0.1', () => {
        const addr = server.address();
        actualPort = typeof addr === 'object' ? addr!.port : port;
        resolve(`http://127.0.0.1:${actualPort}`);
      });
    }),

    stop: () => new Promise((resolve) => {
      if (server) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    }),

    url: (page?: string) => {
      const base = `http://127.0.0.1:${actualPort}`;
      return page ? `${base}/${page.replace(/^\//, '')}` : base;
    },
  };
}
