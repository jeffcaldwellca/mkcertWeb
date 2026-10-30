// ntfy sends the title, priority and tags as HTTP headers. Node's HTTP
// client throws ERR_INVALID_CHAR for header values outside Latin-1, so the
// test button failed against every server (its title had an em dash) since
// 8f8e972. A local capture server stands in for ntfy, so Node's real header
// validation runs on the way out.
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { NtfyService } = require('../src/services/ntfyService');

const ASCII_HEADER = /^[\x20-\x7e]*$/;

// RFC 2047 encoded-word decoder (B encoding only), for asserting round trips.
function decodeHeader(value) {
  const m = /^=\?UTF-8\?B\?([A-Za-z0-9+/=]*)\?=$/i.exec(value);
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : value;
}

async function withCaptureServer(fn) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      requests.push({ url: req.url, headers: req.headers, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"id":"x"}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(url, requests);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const service = (url) => new NtfyService({ ntfy: { enabled: true, url, topic: 'certs' } });

test('the test notification title is a plain ASCII header', async () => {
  await withCaptureServer(async (url, requests) => {
    const result = await service(url).sendTestNotification();
    assert.strictEqual(result.success, true);
    const { headers } = requests[0];
    assert.match(headers.title, ASCII_HEADER);
    assert.strictEqual(headers.title, 'Test Notification - mkcert Web UI');
    for (const name of ['title', 'priority', 'tags']) {
      assert.match(headers[name], ASCII_HEADER, name);
    }
  });
});

test('a non-ASCII title (é, em dash) is RFC 2047 encoded instead of throwing ERR_INVALID_CHAR', async () => {
  await withCaptureServer(async (url, requests) => {
    const title = 'café.dev.local — expires in 3 days';
    await service(url).sendNotification(title, 'body', 'high', ['lock', 'café']);
    const { headers } = requests[0];
    assert.match(headers.title, ASCII_HEADER);
    assert.strictEqual(decodeHeader(headers.title), title);
    assert.match(headers.tags, ASCII_HEADER);
    assert.strictEqual(decodeHeader(headers.tags), 'lock,café');
    assert.strictEqual(headers.priority, 'high');
  });
});

test('an expiry alert for a certificate named with é and an em dash is delivered, name intact in the UTF-8 body', async () => {
  await withCaptureServer(async (url, requests) => {
    const log = console.log;
    console.log = () => {};
    try {
      await service(url).sendCertificateExpiryAlert([
        { domains: ['café.dev.local', 'a—b.dev.local'], priority: 'critical', daysUntilExpiry: 2 },
      ]);
    } finally {
      console.log = log;
    }
    const { headers, body } = requests[0];
    for (const name of ['title', 'priority', 'tags']) assert.match(headers[name], ASCII_HEADER, name);
    assert.match(headers['content-type'], /charset=utf-8/i);
    assert.ok(body.includes('café.dev.local') && body.includes('a—b.dev.local'), body);
  });
});
