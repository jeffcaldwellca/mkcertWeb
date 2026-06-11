const { test } = require('node:test');
const assert = require('node:assert');
const { validateRequest, asyncHandler } = require('../src/utils/responses');

// Minimal mock of an Express res capturing status + json.
function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

test('validateRequest fails validation (400) for a non-string required value instead of throwing', () => {
  const mw = validateRequest({ command: { required: true } });
  const req = { body: { command: 123 }, params: {}, query: {} };
  const res = mockRes();
  let nextCalled = false;

  assert.doesNotThrow(() => mw(req, res, () => { nextCalled = true; }));
  assert.strictEqual(nextCalled, false, 'should not pass validation');
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.success, false);
});

test('validateRequest treats an empty-after-trim string as missing', () => {
  const mw = validateRequest({ command: { required: true } });
  const req = { body: { command: '   ' }, params: {}, query: {} };
  const res = mockRes();
  mw(req, res, () => {});
  assert.strictEqual(res.statusCode, 400);
});

test('validateRequest passes a valid string through to next', () => {
  const mw = validateRequest({ command: { required: true, validate: (v) => v === 'caroot' } });
  const req = { body: { command: 'caroot' }, params: {}, query: {} };
  const res = mockRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(res.body, null);
});

test('asyncHandler forwards a thrown error to next() rather than self-sending', async () => {
  const boom = new Error('boom');
  const handler = asyncHandler(async () => { throw boom; });
  const res = mockRes();
  let forwarded = null;
  await handler({}, res, (err) => { forwarded = err; });
  // Allow the rejected promise's .catch to run.
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(forwarded, boom, 'error should be forwarded to next');
  assert.strictEqual(res.body, null, 'asyncHandler should not write the response itself');
});
