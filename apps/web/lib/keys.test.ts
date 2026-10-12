import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const dir = await mkdtemp(path.join(os.tmpdir(), 'inkcast-job-credentials-'));
process.env.INKCAST_PROJECTS = path.join(dir, 'projects');
process.env.INKCAST_SECRETS_DIR = path.join(dir, 'keys');
process.env.INKCAST_HOSTED = '1';
process.env.INKCAST_SESSION_SECRET = randomBytes(32).toString('hex');
process.env.INKCAST_SECRET_KEY = randomBytes(32).toString('hex');
process.env.CLERK_SECRET_KEY = '';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = '';
const { credentialEnvironment, runWithKeys, withKeys } = await import('./keys');
const { mintSession, ownerTagFor, userSession, requireOwner } =
  await import('../app/api/_lib/session');
const { writeOwnerSecret, deleteOwnerSecret } = await import('../app/api/_lib/secrets');
const { providerEnv, textProvider, cacheDir } = await import('@inkcast/core');
const { redact, trackedCount } = await import('@inkcast/keyvault');
const { anthropicClient } = await import('../../../packages/planner/src/anthropic');
const { createElevenLabsProvider } =
  await import('../../../packages/voice/src/providers/elevenlabs');
const { startJob, waitForJob } = await import('./jobs');
const { upsertProject, readProjectMeta, listProjects } = await import('./store');
const { defaultSelection, selectedVoice } = await import('./provider-selection');
const { accountKeys } = await import('../app/api/_lib/deployment');
const { rootCauseMessage } = await import('../../../packages/pipeline/src/errors');
after(() => rm(dir, { recursive: true, force: true }));

const alice = userSession('alice');
const bob = userSession('bob');
const choice = { planner: 'fireworks', speech: 'elevenlabs', images: 'local' } as const;
const local = { planner: 'local', speech: 'local', images: 'local' } as const;
const fake = (name: string) => `fake-provider-key-for-${name}-123456789`;
const aKey = fake('alice');
const bKey = fake('bob');
const voiceA = fake('voice-alice');
const voiceB = fake('voice-bob');
const save = (session: typeof alice, provider: string, key: string) =>
  writeOwnerSecret({ owner: ownerTagFor(session), provider }, key);

await save(alice, 'fireworks', aKey);
await save(alice, 'elevenlabs', voiceA);
await save(bob, 'fireworks', bKey);
await save(bob, 'elevenlabs', voiceB);

// These sentinels must never become an account job's fallback.
process.env.FIREWORKS_API_KEY = fake('operator');
process.env.ELEVENLABS_API_KEY = fake('operator-voice');
process.env.ANTHROPIC_API_KEY = fake('operator-anthropic');
process.env.FAL_KEY = fake('operator-fal');
process.env.REPLICATE_API_TOKEN = fake('operator-replicate');
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

test('two interleaved jobs send only their own keys through real provider adapters', async () => {
  const originalFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    const auth = headers.get('authorization') ?? headers.get('xi-api-key') ?? '';
    seen.push(auth);
    await pause();
    if (String(input).includes('/voices'))
      return Response.json({
        voices: [
          {
            name: 'River',
            voice_id: auth === voiceA ? 'AliceVoiceId123456789' : 'BobbyVoiceId123456789',
          },
        ],
      });
    return Response.json({ choices: [{ message: { tool_calls: [] } }] });
  };
  const before = { ...process.env };
  const trackedBefore = trackedCount();
  try {
    await Promise.all(
      [
        [alice, aKey, voiceA],
        [bob, bKey, voiceB],
      ].map(async ([session, key, voice]) => {
        await runWithKeys(session as typeof alice, choice, async () => {
          assert.ok(providerEnv().FIREWORKS_API_KEY === key);
          assert.ok(providerEnv().ELEVENLABS_API_KEY === voice);
          assert.equal(providerEnv().ANTHROPIC_API_KEY, undefined);
          assert.equal(textProvider(), 'fireworks');
          const client = await anthropicClient();
          await pause();
          await client!.messages.create({
            model: 'test',
            max_tokens: 1,
            system: '',
            messages: [],
            tools: [],
            tool_choice: { type: 'tool', name: 'test' },
          });
          const id = await createElevenLabsProvider().resolveVoice('River');
          assert.equal(id, session === alice ? 'AliceVoiceId123456789' : 'BobbyVoiceId123456789');
          assert.equal(redact(`failure ${key}`).includes(String(key)), false);
          assert.equal(rootCauseMessage(new Error(String(key))).includes(String(key)), false);
          assert.ok(providerEnv().FIREWORKS_API_KEY === key);
        });
      }),
    );
    assert.equal(seen.length, 4);
    for (const key of [aKey, bKey]) assert.ok(seen.includes(`Bearer ${key}`));
    for (const key of [voiceA, voiceB]) assert.ok(seen.includes(key));
    assert.ok(
      JSON.stringify(process.env) === JSON.stringify(before),
      'process environment changed',
    );
    assert.equal(trackedCount(), trackedBefore, 'customer keys retained globally');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('local selection strips every cloud key even with operator and saved keys', async () => {
  const env = await credentialEnvironment(alice, local);
  for (const name of [
    'FIREWORKS_API_KEY',
    'ELEVENLABS_API_KEY',
    'ANTHROPIC_API_KEY',
    'REPLICATE_API_TOKEN',
    'FAL_KEY',
  ])
    assert.equal(env[name], undefined);
  assert.equal(env.INKCAST_IMAGES, 'off');
  await runWithKeys(alice, local, async () => assert.equal(textProvider(), 'heuristic'));
});

test('missing account credentials never fall through to operator credentials', async () => {
  await assert.rejects(
    credentialEnvironment(userSession('no-keys'), choice),
    /Add your fireworks key/,
  );
  assert.equal(accountKeys({ NODE_ENV: 'test', CLERK_SECRET_KEY: 'set' }), true);
  assert.equal(accountKeys({ NODE_ENV: 'test', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'set' }), true);
  assert.equal(accountKeys({ NODE_ENV: 'test', INKCAST_HOSTED: '0' }), false);
});

test('queued runner loads a replacement at admission and refuses a deleted key', async () => {
  const session = mintSession();
  await save(session, 'fireworks', fake('queued-old'));
  const selection = { ...local, planner: 'fireworks' } as const;
  let used = '';
  const runner = withKeys(session, selection, async () => {
    used = providerEnv().FIREWORKS_API_KEY!;
    return { videoPath: 'out.mp4' };
  });
  await save(session, 'fireworks', fake('queued-new'));
  const ctx = { lease: async <T>(_kind: unknown, work: () => Promise<T>) => work() };
  await runner(() => {}, ctx);
  assert.ok(used === fake('queued-new'));
  await deleteOwnerSecret({ owner: ownerTagFor(session), provider: 'fireworks' });
  await assert.rejects(
    runner(() => {}, ctx),
    /Add your fireworks key/,
  );
});

test('job progress, persisted failure and replayed events contain no plaintext key', async () => {
  const id = 'credential-redaction';
  await upsertProject(id, { ownerSession: ownerTagFor(alice) });
  startJob(
    id,
    'cast',
    withKeys(alice, choice, async (progress) => {
      progress({ stage: 'plan', pct: 0.2, note: `provider echoed ${aKey}` });
      throw new Error(`provider echoed ${aKey} and ${voiceA}`);
    }),
  );
  const result = await waitForJob(id);
  assert.equal(result?.status, 'error');
  const disk = await readFile(path.join(process.env.INKCAST_PROJECTS!, id, 'meta.json'), 'utf8');
  for (const key of [aKey, voiceA]) {
    assert.equal(JSON.stringify(result).includes(key), false);
    assert.equal(disk.includes(key), false);
  }
  assert.equal((await requireOwner(id, bob)).ok, false);
});

test('two accounts racing to claim one explicit project id cannot transfer ownership', async () => {
  const attempts = await Promise.allSettled(
    [alice, bob].map((session) =>
      upsertProject('same-new-id', { ownerSession: ownerTagFor(session) }, ownerTagFor(session)),
    ),
  );
  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
  const owner = (await readProjectMeta('same-new-id'))?.ownerSession;
  assert.ok(owner === ownerTagFor(alice) || owner === ownerTagFor(bob));
});

test('Fireworks and ElevenLabs are independent choices; voice pin preserves the speech selection', () => {
  assert.deepEqual(
    defaultSelection([
      { id: 'fireworks', configured: true },
      { id: 'elevenlabs', configured: true },
    ]),
    choice,
  );
  assert.equal(selectedVoice(choice, 'River'), 'elevenlabs:River');
  assert.equal(selectedVoice(local, 'elevenlabs:River'), 'kokoro:af_heart');
});

test('credentials are encrypted on disk and never copied into project metadata', async () => {
  const files = (await readdir(process.env.INKCAST_SECRETS_DIR!)).filter((file) =>
    file.endsWith('.json'),
  );
  for (const file of files) {
    const text = await readFile(path.join(process.env.INKCAST_SECRETS_DIR!, file), 'utf8');
    for (const key of [aKey, bKey, voiceA, voiceB]) assert.equal(text.includes(key), false);
  }
});

test('account jobs cannot reuse another account or operator generated-asset cache', async () => {
  const operatorCache = cacheDir('drawings');
  const dirs = await Promise.all(
    [alice, bob].map((session) =>
      runWithKeys(session, local, async () => {
        await pause();
        return cacheDir('drawings');
      }),
    ),
  );
  assert.notEqual(dirs[0], dirs[1]);
  assert.ok(dirs.every((dir) => dir !== operatorCache && dir.includes('.account-cache')));
  assert.equal(cacheDir('drawings'), operatorCache);
});

test('Clerk account mode hides and refuses unowned projects even without the hosted flag', async () => {
  await upsertProject('operator-unowned-film', { title: 'Private operator film' });
  const originalHosted = process.env.INKCAST_HOSTED;
  const originalClerk = process.env.CLERK_SECRET_KEY;
  try {
    process.env.INKCAST_HOSTED = '0';
    process.env.CLERK_SECRET_KEY = 'fake-configured-clerk';
    const projects = await listProjects({ ownerSession: ownerTagFor(alice) });
    assert.equal(
      projects.some((project) => project.id === 'operator-unowned-film'),
      false,
    );
    assert.equal((await requireOwner('operator-unowned-film', alice)).ok, false);
    await assert.rejects(
      upsertProject(
        'operator-unowned-film',
        { ownerSession: ownerTagFor(alice) },
        ownerTagFor(alice),
      ),
      /ownership changed/,
    );
  } finally {
    process.env.INKCAST_HOSTED = originalHosted;
    process.env.CLERK_SECRET_KEY = originalClerk;
  }
});

test('requests outside localhost cannot spend the local operator vault through job routes', async () => {
  const originalHosted = process.env.INKCAST_HOSTED;
  try {
    process.env.INKCAST_HOSTED = '0';
    const routes = await Promise.all([
      import('../app/api/generate/route'),
      import('../app/api/projects/[id]/edit/route'),
      import('../app/api/projects/[id]/rerender/route'),
    ]);
    for (const route of routes) {
      const request = new Request('https://unconfigured-shared-box.example/api/generate', {
        method: 'POST',
        headers: { 'X-Inkcast-Request': '1' },
      });
      const response = await route.POST(request, { params: Promise.resolve({ id: 'a-project' }) });
      assert.equal(response.status, 403);
    }
  } finally {
    process.env.INKCAST_HOSTED = originalHosted;
  }
});
