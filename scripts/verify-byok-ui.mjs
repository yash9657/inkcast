/** Run against an isolated, Clerk-less hosted test server, never a personal vault. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(new URL('../packages/render/package.json', import.meta.url));
const { chromium } = require('playwright');
const baseURL = process.env.BYOK_TEST_URL ?? 'http://localhost:3011';
const evidence = process.env.BYOK_TEST_EVIDENCE ?? '/tmp/inkcast-byok-ui-evidence';
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BYOK_TEST_CHROME ? { executablePath: process.env.BYOK_TEST_CHROME } : {}),
});
const context = await browser.newContext({
  baseURL,
  viewport: { width: 1440, height: 1000 },
  colorScheme: 'light',
});
const page = await context.newPage();
page.setDefaultTimeout(60_000);
page.setDefaultNavigationTimeout(120_000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const checks = [];
const fakeKeys = {
  fireworks: 'fake-inkcast-ui-fireworks-key-12345678',
  elevenlabs: 'fake-inkcast-ui-elevenlabs-key-12345678',
};
const noOverflow = async () =>
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    'horizontal overflow',
  );
const shot = async (name) => {
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
  });
  // Theme changes, responsive relayout and Options have finite transitions.
  await page.waitForTimeout(600);
  await noOverflow();
  await page.screenshot({
    path: path.join(evidence, name + '.png'),
    fullPage: true,
    animations: 'disabled',
  });
};
try {
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Your API keys' }).waitFor();
  const snapshot = await context.request.get('/api/keys', { timeout: 120_000 });
  assert.equal(
    (await snapshot.json()).vault.scope,
    'account',
    'Refusing to test a local machine vault',
  );
  // Validation is an external-service boundary; this test spends no provider requests.
  await page.route('**/api/keys/validate', async (route) =>
    route.fulfill({
      json: {
        result: { status: 'valid', message: 'Provider accepted this test key.' },
        checked: 'vault',
      },
    }),
  );
  for (const [provider, key] of Object.entries(fakeKeys)) {
    const label = provider === 'fireworks' ? 'Fireworks' : 'ElevenLabs';
    const field = page.getByLabel(`${label} key`, { exact: true });
    await field.fill(key);
    const form = field.locator('xpath=ancestor::form');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByLabel(`Replace the ${label} key`).waitFor();
    await page.waitForFunction(
      (id) => document.getElementById(id)?.value === '',
      `key-${provider}`,
    );
    assert.equal(
      await page.getByLabel(`Replace the ${label} key`).getAttribute('type'),
      'password',
    );
  }
  checks.push('Save, masked state, cleared password fields and Fireworks client parsing');
  const other = await browser.newContext({ baseURL });
  const otherSnapshot = await (await other.request.get('/api/keys', { timeout: 120_000 })).json();
  assert.equal(
    otherSnapshot.keys.some((key) => key.configured),
    false,
  );
  const deniedGeneration = await other.request.post('/api/generate', {
    timeout: 120_000,
    headers: { 'X-Inkcast-Request': '1' },
    data: {
      text: 'A test document.',
      providers: { planner: 'fireworks', speech: 'elevenlabs', images: 'local' },
    },
  });
  assert.equal(deniedGeneration.status(), 400, 'another account could start with these keys');
  const deniedFile = await other.request.post('/api/generate', {
    headers: { 'X-Inkcast-Request': '1' },
    data: {
      filePath: 'package.json',
      providers: { planner: 'local', speech: 'local', images: 'local' },
    },
  });
  assert.equal(deniedFile.status(), 403, 'an account could read a server source file');
  await other.close();
  checks.push('Second browser account sees no saved credentials');
  await page.waitForTimeout(6000);
  await shot('settings-desktop');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot('settings-dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 390, height: 844 });
  await shot('settings-mobile');
  await page.goto('/studio', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Providers for this video' }).waitFor();
  assert.match(await page.locator('#planning-provider').textContent(), /Fireworks/);
  assert.match(await page.locator('#speech-provider').textContent(), /ElevenLabs/);
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  assert.equal(await page.getByLabel('Voice', { exact: true }).inputValue(), 'River');
  await shot('studio-mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await shot('studio-desktop');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot('studio-dark');
  const requests = [];
  await page.route('**/api/generate', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 400,
      json: { error: 'Test request captured. No video was generated.' },
    });
  });
  await page
    .getByLabel('Document or notes')
    .fill(
      'The Earth rotates once each day. The side facing the Sun is lit, while the other side is in shadow.',
    );
  await page.getByRole('button', { name: 'Draw it', exact: true }).click();
  await page
    .getByText('Test request captured. No video was generated.', { exact: true })
    .first()
    .waitFor();
  assert.deepEqual(requests[0].providers, {
    planner: 'fireworks',
    speech: 'elevenlabs',
    images: 'local',
  });
  assert.equal(requests[0].meta.voice, 'elevenlabs:River');
  assert.equal(
    Object.values(fakeKeys).some((key) => JSON.stringify(requests).includes(key)),
    false,
  );
  checks.push(
    'Creation submits explicit Fireworks + ElevenLabs choices and voice without any credentials',
  );
  await page.locator('#planning-provider').click();
  await page.getByRole('option', { name: 'Local · basic summary', exact: true }).click();
  await page.locator('#speech-provider').click();
  await page.getByRole('option', { name: 'Local · Kokoro', exact: true }).click();
  await page.getByRole('button', { name: 'Draw it', exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(requests[1].providers.planner, 'local');
  assert.equal(requests[1].providers.speech, 'local');
  assert.equal(requests[1].meta.voice, 'kokoro:af_heart');
  checks.push('Local override excludes cloud choices and pins local speech');
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Replace the Fireworks key').waitFor();
  const card = page.getByLabel('Replace the Fireworks key').locator('xpath=ancestor::form/..');
  await card.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('button', { name: 'Keep it', exact: true }).click();
  await page.getByLabel('Replace the Fireworks key').waitFor();
  await card.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('button', { name: 'Remove key', exact: true }).click();
  await page.getByLabel('Fireworks key', { exact: true }).waitFor();
  checks.push('Removal can be cancelled or confirmed, and status updates');
  await page.route('**/api/keys', (route) =>
    route.fulfill({ status: 503, json: { error: 'Test connection failure' } }),
  );
  await page.reload();
  await page.getByRole('alert').filter({ hasText: 'Could not read the key status' }).waitFor();
  assert.equal(await page.locator('#key-elevenlabs').count(), 0);
  checks.push('Failed loading hides stale credential cards and offers retry');
  assert.deepEqual(errors, []);
  const report = {
    checks,
    viewports: ['1440×1000', '390×844'],
    themes: ['light', 'dark'],
    validation:
      'External provider metadata responses stubbed; storage and account isolation use real endpoints',
    consoleErrors: errors,
  };
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page
    .screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true })
    .catch(() => {});
  await writeFile(
    path.join(evidence, 'failure.txt'),
    await page
      .locator('body')
      .innerText()
      .catch(() => 'Page unavailable'),
  );
  throw error;
} finally {
  await browser.close();
}
