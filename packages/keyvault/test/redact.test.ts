/**
 * Leak prevention. The assertions are deliberately shaped as "the secret does
 * not appear in the output", not "the output equals this string" — the guarantee
 * is about absence, and a future rule change should be free to alter the
 * placeholder without failing these tests.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  forgetSecrets,
  installRedaction,
  mask,
  redact,
  redactDeep,
  redactError,
  redactionInstalled,
  trackSecret,
  uninstallRedaction,
} from '../src/index.js';
import { FAKE } from './helpers.js';

test('redact() catches every provider key format', () => {
  const cases: Array<[string, string]> = [
    ['anthropic', FAKE.anthropic],
    ['elevenlabs (sk_)', FAKE.elevenlabs],
    ['elevenlabs (legacy 32-hex)', FAKE.elevenlabsLegacy],
    ['replicate', FAKE.replicate],
    ['fal (uuid:hex)', FAKE.fal],
    ['huggingface', FAKE.huggingface],
    ['github', FAKE.github],
    ['openai-style sk-', FAKE.openai],
  ];
  for (const [label, key] of cases) {
    const line = `info planner using key ${key} for this run`;
    const out = redact(line);
    assert.ok(!out.includes(key), `${label}: the key survived redaction -> ${out}`);
    assert.ok(out.includes('planner using key'), `${label}: surrounding text was destroyed`);
  }
});

test('redact() catches keys in the shapes they actually leak in', () => {
  const key = FAKE.anthropic;
  const carriers = [
    `Authorization: Bearer ${key}`,
    `x-api-key: ${key}`,
    `xi-api-key:${FAKE.elevenlabsLegacy}`,
    `Authorization: Token ${FAKE.replicate}`,
    `Authorization: Key ${FAKE.fal}`,
    `ANTHROPIC_API_KEY=${key}`,
    `REPLICATE_API_TOKEN="${FAKE.replicate}"`,
    `FAL_KEY='${FAKE.fal}'`,
    `{"apiKey":"${key}"}`,
    `{"api_key": "${FAKE.elevenlabsLegacy}"}`,
    `curl -H 'x-api-key: ${key}' https://api.anthropic.com/v1/models`,
    `Error: request failed with key=${key} status=401`,
    `INKCAST_VAULT_PASSPHRASE=correct-horse-battery-staple-42`,
  ];
  for (const carrier of carriers) {
    const out = redact(carrier);
    for (const secret of [key, FAKE.replicate, FAKE.fal, FAKE.elevenlabsLegacy]) {
      assert.ok(!out.includes(secret), `secret survived in: ${carrier}\n  -> ${out}`);
    }
    assert.ok(!out.includes('correct-horse-battery-staple-42'), `passphrase survived: ${out}`);
  }
});

test('redact() leaves ordinary log lines alone', () => {
  const lines = [
    'info voice measured scene s3 at 4.28s',
    'warn ELEVENLABS_API_KEY is not set — using the local Kokoro voice',
    'The key insight is that Token ring networks are obsolete.',
    'Key features: persistent canvas, fractional timing.',
    'render captured 164 frames in 21.4s',
    'plot domain [-3, 3] sampled at 128 points',
  ];
  for (const line of lines) {
    assert.equal(redact(line), line, `redaction damaged: ${line}`);
  }
});

test('absolute paths survive — `/` is in the base64 alphabet but a path is not a key', () => {
  // Regression: `[A-Za-z0-9+/]{40,}` also describes every absolute path on this
  // machine, so `inkcast --json` reported
  // `"videoPath": "«redacted:base64»-lesson/out.mp4"` and the CLI's whole
  // machine-readable contract became unusable. Redaction that damages ordinary
  // output gets turned off wholesale, which costs more than it saves.
  const paths = [
    '/Users/yashbhalgat/code/inkcast/projects/integ-lesson/out.mp4',
    '/Users/somebody/code/inkcast/examples/lessons/gradient-descent.lesson.json',
    '/home/runner/work/inkcast/inkcast/projects/2026-07-28-gradient-descent',
    '/opt/homebrew/Cellar/node20/lib/node_modules/inkcast/packages/render/src',
    '/Users/a/Library/Application Support/inkcast/projects/abc123/assets/visuals.json',
  ];
  for (const p of paths) {
    assert.equal(redact(`wrote ${p}`), `wrote ${p}`, `a path was damaged: ${redact(p)}`);
  }
});

test('standard-alphabet base64 blobs are still masked, slashes and all', () => {
  // The narrowing above must not become a hole: these are what the rule is for.
  const blobs = [
    Buffer.from('inkcast-secret-value-long-enough-to-encode-widely').toString('base64'),
    'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODkwQUJDREVGRw==',
    // No padding, contains `/`, but one unbroken 24-character run.
    'aGVsbG8vd29ybGQ/QUJDRGVmZ2hJakts/MDEyMzQ1Njc4OWFiY2RlZmdoaWpr',
  ];
  for (const blob of blobs) {
    const out = redact(`Authorization: Basic ${blob}`);
    assert.ok(!out.includes(blob), `a base64 blob survived: ${out}`);
  }
});

test('long hex and base64 runs are masked by default and skippable', () => {
  const digest = 'a'.repeat(64);
  assert.ok(!redact(`cache hit ${digest}`).includes(digest), 'a 64-hex run should be masked');
  // Documented escape hatch for call sites that need digests readable.
  assert.ok(
    redact(`cache hit ${digest}`, { generic: false }).includes(digest),
    '{generic:false} must leave long runs intact',
  );
  // Short hex — a colour, a scene index — must survive.
  assert.equal(redact('stroke #1a2b3c'), 'stroke #1a2b3c');
});

test('masked previews survive redaction — that is what they are for', () => {
  // A status listing printed through the stdout hook must stay readable. The
  // preview begins with a public prefix long enough to look like a real key, so
  // this is the case that regressed before the hold-out pass existed.
  for (const key of Object.values(FAKE)) {
    const preview = mask(key);
    const line = `anthropic  ${preview}  (vault)`;
    assert.equal(redact(line), line, `a masked preview was destroyed: ${redact(line)}`);
  }
  // The fully-bulleted form too.
  assert.equal(redact('elevenlabs  sk_••••••'), 'elevenlabs  sk_••••••');
});

test('the preview exemption cannot be used to smuggle a real key', () => {
  // Adversarial: a genuine key with an ellipsis stuck on the end. The hold-out
  // is bounded to six characters, so the key itself must still be redacted.
  const key = FAKE.anthropic;
  const out = redact(`token ${key}…abcd`);
  assert.ok(!out.includes(key), `the exemption leaked a whole key: ${out}`);
  assert.ok(!out.includes(key.slice(0, 24)), `a long fragment survived: ${out}`);
});

test('tracked values are redacted by exact match, whatever their shape', () => {
  // A key in a format no pattern anticipates: the tracking layer is the only
  // thing that can catch this, which is why it is on by default.
  const weird = 'inkcast-unusual-credential-2026';
  try {
    assert.ok(redact(weird).includes(weird), 'not yet tracked, so not yet masked');
    trackSecret(weird);
    assert.ok(!redact(`using ${weird} now`).includes(weird), 'tracking failed');
    // ...and in the encodings it might be re-serialised into on the way out.
    const b64 = Buffer.from(weird).toString('base64');
    assert.ok(!redact(`Authorization: Basic ${b64}`).includes(b64), 'base64 form survived');
    assert.ok(
      !redact(`?token=${encodeURIComponent(weird)}`).includes(encodeURIComponent(weird)),
      'url-encoded form survived',
    );
  } finally {
    forgetSecrets();
  }
  assert.ok(redact(weird).includes(weird), 'forgetSecrets() should clear the table');
});

test('short values are never tracked', () => {
  try {
    trackSecret('the');
    assert.equal(redact('the quick brown fox'), 'the quick brown fox');
  } finally {
    forgetSecrets();
  }
});

test('redactError scrubs the message, the stack and the cause', () => {
  const key = FAKE.anthropic;
  const inner = new Error(`upstream rejected ${key}`);
  const outer = new Error(`planner failed with x-api-key: ${key}`, { cause: inner });
  (outer as Error & { request?: unknown }).request = { headers: { 'x-api-key': key } };

  const clean = redactError(outer);
  assert.ok(!clean.message.includes(key), 'message leaked');
  assert.ok(!(clean.stack ?? '').includes(key), 'stack leaked');
  assert.ok(!JSON.stringify(clean.cause).includes(key), 'cause leaked');
  assert.ok(
    !JSON.stringify((clean as Error & { request?: unknown }).request).includes(key),
    'attached property leaked',
  );
  assert.equal(clean.name, outer.name);
});

test('redactDeep scrubs SSE and HTTP payloads, including by property name', () => {
  const key = FAKE.anthropic;
  const event = {
    stage: 'plan',
    pct: 40,
    note: `calling claude with ${key}`,
    config: {
      apiKey: key,
      // A short value no pattern would match, caught because of its name.
      token: 'abc123',
      voice: 'af_heart',
    },
    history: [`x-api-key: ${key}`, 'ok'],
  };
  const clean = redactDeep(event);
  const json = JSON.stringify(clean);
  assert.ok(!json.includes(key), `key leaked into an SSE frame: ${json}`);
  assert.ok(!json.includes('abc123'), 'a short secret-named value survived');
  assert.equal(clean.pct, 40, 'non-string data must be preserved');
  assert.equal(clean.config.voice, 'af_heart', 'innocent values must be preserved');
  assert.equal(clean.history[1], 'ok');
});

test('redactDeep survives circular structures', () => {
  const node: Record<string, unknown> = { name: 'root' };
  node.self = node;
  const clean = redactDeep(node) as Record<string, unknown>;
  assert.equal(clean.name, 'root');
  assert.equal(clean.self, '«circular»');
});

test('installRedaction stops a key reaching stdout or stderr', () => {
  const key = FAKE.anthropic;
  const captured: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);

  // Capture beneath the hook so we see exactly what would hit the terminal.
  process.stdout.write = ((chunk: unknown) => {
    captured.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    captured.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  }) as typeof process.stderr.write;

  try {
    const uninstall = installRedaction();
    assert.ok(redactionInstalled());
    try {
      console.log(`planner key ${key}`);
      console.error(`Authorization: Bearer ${key}`);
      process.stdout.write(Buffer.from(`buffered ${key}\n`, 'utf8'));
      // A binary write must pass through untouched.
      process.stdout.write(Buffer.from([0x00, 0x01, 0xff, 0xfe]));
    } finally {
      uninstall();
    }
    assert.equal(redactionInstalled(), false, 'uninstall must restore the streams');

    const all = captured.join('');
    assert.ok(!all.includes(key), `a key reached the stream: ${all}`);
    assert.ok(all.includes('planner key'), 'the log line itself should survive');
    assert.ok(all.includes('buffered'), 'buffered writes should still be delivered');

    // After uninstalling, writes are untouched again (proving the hook was the
    // thing doing the work, not some ambient behaviour).
    console.log(`plain ${key}`);
    assert.ok(captured.join('').includes(key), 'uninstall did not restore the original writer');
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    uninstallRedaction();
  }
});

test('installRedaction is idempotent', () => {
  try {
    const first = installRedaction();
    const second = installRedaction();
    assert.equal(first, second, 'a second install must not stack another wrapper');
  } finally {
    uninstallRedaction();
  }
});
