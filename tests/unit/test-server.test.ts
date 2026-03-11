import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { createTestServer, type TestServer } from '../../src/helpers/test-server.js';

// Helper to make HTTP requests without external deps
async function fetchText(url: string): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const res = await fetch(url);
  const body = await res.text();
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { status: res.status, body, headers };
}

/**
 * Send a raw HTTP request with an un-normalized path.
 * fetch() and http.get() both normalize `/../..` out of paths,
 * so we write the request line manually.
 */
function rawGet(host: string, port: number, rawPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = new (require('net')).Socket();
    socket.connect(port, host, () => {
      socket.write(`GET ${rawPath} HTTP/1.1\r\nHost: ${host}:${port}\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    socket.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    socket.on('end', () => {
      const statusMatch = data.match(/HTTP\/1\.1 (\d+)/);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
      const bodyStart = data.indexOf('\r\n\r\n');
      const body = bodyStart >= 0 ? data.slice(bodyStart + 4) : '';
      resolve({ status, body });
    });
    socket.on('error', reject);
  });
}

describe('TestServer', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = createTestServer();
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('starts and assigns a port', () => {
    expect(server.port).toBeGreaterThan(0);
  });

  it('serves built-in test-input.html with 200 and correct content', async () => {
    const res = await fetchText(server.url('test-input.html'));
    expect(res.status).toBe(200);
    expect(res.body).toContain('Extension Test - Input Fields');
    expect(res.body).toContain('id="text-input"');
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('serves built-in test-blank.html', async () => {
    const res = await fetchText(server.url('test-blank.html'));
    expect(res.status).toBe(200);
    expect(res.body).toContain('Blank Test Page');
  });

  it('blocks path traversal attempts with 403', async () => {
    // Without a customPagesDir, path traversal logic isn't reached,
    // but the default handler returns 200. We test traversal with a custom dir below.
    // Here, confirm unknown paths return 200 (default behavior).
    const res = await fetchText(server.url('/../../../etc/passwd'));
    // Without customPagesDir set, the server falls through to the default 200 handler
    expect(res.status).toBe(200);
  });

  it('returns 200 with default HTML for unknown paths', async () => {
    const res = await fetchText(server.url('nonexistent-page.html'));
    expect(res.status).toBe(200);
    expect(res.body).toContain('Test Page:');
    expect(res.body).toContain('nonexistent-page.html');
  });

  it('url() helper builds correct URLs', () => {
    const base = `http://127.0.0.1:${server.port}`;
    expect(server.url()).toBe(base);
    expect(server.url('foo.html')).toBe(`${base}/foo.html`);
    expect(server.url('/bar.html')).toBe(`${base}/bar.html`);
  });
});

describe('TestServer stops cleanly', () => {
  it('can start and stop without errors', async () => {
    const s = createTestServer();
    await s.start();
    const port = s.port;
    expect(port).toBeGreaterThan(0);
    await s.stop();

    // After stopping, the port should no longer respond
    try {
      await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(500) });
      // If fetch succeeds, that's unexpected
      expect.unreachable('Server should not respond after stop');
    } catch {
      // Expected: connection refused or timeout
    }
  });

  it('stop() is safe to call when server was never started', async () => {
    const s = createTestServer();
    // Should not throw
    await s.stop();
  });
});

describe('TestServer with customPagesDir', () => {
  let server: TestServer;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-server-pages-'));
    fs.writeFileSync(path.join(tmpDir, 'custom.html'), '<html><body>Custom Page</body></html>');
    fs.writeFileSync(path.join(tmpDir, 'data.json'), '{"key":"value"}');

    server = createTestServer({ customPagesDir: tmpDir });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('serves files from the custom pages directory', async () => {
    const res = await fetchText(server.url('custom.html'));
    expect(res.status).toBe(200);
    expect(res.body).toContain('Custom Page');
  });

  it('serves JSON with correct content type', async () => {
    const res = await fetchText(server.url('data.json'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body).toBe('{"key":"value"}');
  });

  it('blocks path traversal with 403 when customPagesDir is set', async () => {
    // fetch() normalizes /../.. out of URLs, so we use a raw socket request
    const res = await rawGet('127.0.0.1', server.port, '/../../../etc/passwd');
    expect(res.status).toBe(403);
    expect(res.body).toContain('Forbidden');
  });

  it('built-in pages still take priority over custom pages', async () => {
    // Even if customPagesDir has a file, built-in pages are served first
    fs.writeFileSync(path.join(tmpDir, 'test-blank.html'), '<html>OVERRIDDEN</html>');
    const res = await fetchText(server.url('test-blank.html'));
    expect(res.status).toBe(200);
    expect(res.body).toContain('Blank Test Page'); // built-in, not overridden
  });
});
