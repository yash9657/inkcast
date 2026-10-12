# @inkcast/keyvault

Bring-your-own-key credential storage for Inkcast.

Inkcast runs end to end with no API keys at all — the planner, the voice and the
artwork each have a local default. A key is only ever an **opt-in upgrade for one
stage**, and that shapes everything in this package: storing a key is deliberate,
reading one degrades quietly when it is absent, and a key must never reach a log
line, an SSE frame, an HTTP response body, or a stack trace.

```ts
import {
  installRedaction,
  setKey,
  getKey,
  listProviders,
  deleteKey,
  validateKey,
} from '@inkcast/keyvault';

installRedaction(); // once, at process start
await setKey('anthropic', key); // keychain on macOS, else encrypted vault
const key = await getKey('anthropic'); // env first, then storage
await listProviders(); // masked previews only, never a raw key
await validateKey('anthropic'); // one free metadata call
await deleteKey('anthropic');
```

Providers: `fireworks`, `anthropic`, `elevenlabs`, `replicate`, `fal`.

---

## Storage design

Two backends. On macOS the OS keychain is preferred, because then **no Inkcast
file ever contains a secret** — there is nothing to leak, back up, or commit.
Everywhere else, an encrypted vault file.

### macOS keychain (default on darwin)

Driven through `/usr/bin/security`, one generic-password item per provider under
service `inkcast` (override with `INKCAST_KEYCHAIN_SERVICE`):

| operation | invocation                                                                                    |
| --------- | --------------------------------------------------------------------------------------------- |
| write     | `security add-generic-password -U -s inkcast -a <provider> -D 'Inkcast API key' -l … -j … -w` |
| read      | `security find-generic-password -s inkcast -a <provider> -w`                                  |
| exists    | `security find-generic-password -s inkcast -a <provider>` (no `-w`, no secret read)           |
| delete    | `security delete-generic-password -s inkcast -a <provider>`                                   |

Two details are load-bearing, both verified against the real CLI:

- **The secret goes on stdin, never in `argv`.** `security`'s own usage text calls
  `-w <password>` insecure: argv is readable via `ps` for the same user and can be
  captured by process accounting. Passing `-w` **last with no value** makes
  `security` prompt, and it reads that prompt from a pipe.
- **The password must be written twice.** The prompt is `password data for new
item:` then `retype password for new item:`. Supplying one line leaves the second
  read at EOF, both compare equal as empty, and `security` stores an **empty
  password and exits 0**. `setKey()` therefore reads the value back and compares
  before reporting success.

Exit codes: `44` = not found, `45` = already exists (only reachable without `-U`).
Because the item is created by `/usr/bin/security`, subsequent reads by the same
binary need no extra authorisation — there is no prompt on every read, and we
never pass the insecure `-A` ("any application may access this").

### Encrypted vault file (everywhere else)

`~/.inkcast/vault.json`, mode `0600`, in a directory created `0700`.

- **AES-256-GCM**, one envelope per provider, 96-bit random IV per write.
- **Random 32-byte salt per vault**, so two machines holding the same key produce
  different ciphertext and no precomputation is shared.
- **scrypt** key derivation from a user passphrase: `N=2^16, r=8, p=1×2` — 64 MiB
  and ~190 ms. `p=2` doubles the work without doubling memory, which suits a CLI
  that derives once per invocation. Parameters live _in the file_, so they can be
  raised later without breaking existing vaults.
- **Authenticated, and bound to its own metadata.** Each entry's additional
  authenticated data is `inkcast-vault/1|<provider>|<masked>|<createdAt>`, so a
  ciphertext moved from one provider to another — or a masked preview edited to
  misrepresent which key is stored — fails authentication instead of succeeding
  quietly. Any modification raises `KeyvaultError('tampered')`; it is never
  reported as "no key configured".
- **A separate verifier blob** distinguishes a wrong passphrase
  (`bad-passphrase`) from a modified file (`tampered`) — both are GCM failures, and
  guessing wrong would mean accusing the user's disk.
- **Atomic writes**: temp file at `0600`, then `rename`, so a crash cannot leave a
  truncated vault where a complete one used to be.

```json
{
  "version": 1,
  "kdf": { "name": "scrypt", "salt": "…", "N": 65536, "r": 8, "p": 2, "keyLen": 32 },
  "verifier": { "iv": "…", "ct": "…", "tag": "…" },
  "entries": {
    "anthropic": {
      "iv": "…",
      "ct": "…",
      "tag": "…",
      "masked": "sk-ant-api03-Sm…aaaa",
      "createdAt": "…"
    }
  }
}
```

**Which providers are configured is deliberately not secret.** Entry names and
masked previews sit in the clear so `listProviders()` never needs a passphrase —
otherwise every status screen becomes a password prompt. Only key material is
encrypted.

Passphrase resolution, in order: the `passphrase` option → `INKCAST_VAULT_PASSPHRASE`
→ `INKCAST_VAULT_PASSPHRASE_FILE` (better on a runner: an env var is visible in
`docker inspect` and in crash dumps) → a no-echo TTY prompt. **There is no
recovery if you forget it** — delete the vault and re-add your keys.

### A non-secret sidecar

`~/.inkcast/keyvault-meta.json` (`0600`) holds only `lastValidated`, whether that
check passed, the masked preview, and an `updatedAt`. It exists so
`listProviders()` is backend-agnostic: the keychain has nowhere to hang "last
validated Tuesday" that we can read without pulling out the secret. **It never
contains key material** — `0600` here is hygiene, not the security boundary.

---

## Precedence

`getKey()` resolves **readable storage first, then `process.env`** (the older environment-first behavior was superseded):

1. The keychain or encrypted vault, when its saved key is readable.
2. `FIREWORKS_API_KEY`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`,
   `REPLICATE_API_TOKEN`, or `FAL_KEY` (`FAL_API_KEY` is also accepted).

Environment keys remain available when no readable saved key exists. An empty
variable counts as unset. `listProviders()` reports which source wins and whether
a stored key overrides the environment, or an unreadable entry falls back to it.
This fallback applies to the local machine vault only. Web account jobs never
fall back to server environment credentials.

```ts
[
  {
    provider: 'anthropic',
    configured: true,
    masked: 'sk-ant-api03-Sm…aaaa', // never a raw key
    lastValidated: '2026-07-28T23:12:04.881Z',
    source: 'env',
  },
];
```

---

## Validating a key

`validateKey()` makes the cheapest authenticated call each provider offers — a
metadata or account read that bills nothing and mutates nothing, never an
inference or synthesis call. The endpoints were probed with a deliberately invalid key
to confirm the URL and header shape (each returns 401, not 404):

| provider     | request                                    | auth header                       |
| ------------ | ------------------------------------------ | --------------------------------- |
| `fireworks`  | `GET api.fireworks.ai/inference/v1/models` | `Authorization: Bearer …`         |
| `anthropic`  | `GET api.anthropic.com/v1/models?limit=1`  | `x-api-key` + `anthropic-version` |
| `elevenlabs` | `GET api.elevenlabs.io/v1/user`            | `xi-api-key`                      |
| `replicate`  | `GET api.replicate.com/v1/account`         | `Authorization: Token …`          |
| `fal`        | `POST rest.alpha.fal.ai/tokens/`           | `Authorization: Key …`            |

fal has no free account-read endpoint, so we ask its token service for a
short-lived scoped JWT — fal's own documented way to exchange a key, and free.

These are raw `fetch` calls rather than SDK calls on purpose: adding
`@anthropic-ai/sdk` to a credential-storage package to make one metadata `GET`
would give the vault a dependency on the very layer it exists to serve, and several
providers have no SDK in this workspace at all. One uniform path keeps
the security-relevant surface small.

`validateKey()` never throws. `2xx` → `ok`. `401` → `rejected`. `403` →
`forbidden` (the metadata request was refused). `429` → `rate-limited`.
Neither establishes whether the key can generate. These uncertain results, along
with `5xx` and network failures, return `ok: false` but are **not** recorded as
invalid credentials; only a definitive acceptance or rejection updates the saved verdict.

---

## Making a stored key take effect

The CLI still uses `hydrateEnv()` for its single-user process. Saved keys take priority;
`dehydrate()` restores variables the CLI overrode. This facility must not be used in a
shared web server: environment variables are process-global and inherited by children.

Web jobs instead use `apps/web/lib/keys.ts` and core's `withProviderEnv()` async scope.
Account credentials are resolved for the authenticated owner at job admission; local web
jobs use `createKeyvault({ interactive: false, track: false })`. Each job receives an
immutable provider environment without mutating `process.env`. `withSecretRedaction()`
provides job-scoped exact-value redaction without permanently retaining customer keys.
See [AUTH.md](../../docs/AUTH.md) for storage, request protections and operational limits.

---

## Leak prevention

`redact(text)` scrubs anything key-shaped, in two layers:

1. **Exact match on tracked values.** Every key this package hands out is
   registered in a process-local table and replaced by literal match. This is the
   only layer that can catch a key in a format we never anticipated, which is why
   it is on by default (`INKCAST_KEYVAULT_TRACK=0` disables it).
2. **Shape match**: `sk-ant-…`, `sk-…`, `sk_…`, `r8_…`, `hf_…`, `ghp_…`, fal's
   `uuid:secret`, `Bearer`/`Token`/`Key` tokens, `x-api-key:` and `Authorization:`
   headers, `FOO_TOKEN=…` assignments, `"apiKey": "…"` JSON, and long
   hex / base64 runs.

`installRedaction()` routes **everything written to stdout and stderr** through it.
Patching the two streams — rather than wrapping our own logger — is what makes the
guarantee hold end to end: `@inkcast/core`'s `logger` writes there, so does
`console.*`, and so does Node's own uncaught-exception and unhandled-rejection
reporter. One hook covers log lines, error paths and stack traces alike, and a
stage that never imports this package still cannot print a key it got from
`getKey()`. It is idempotent and returns an uninstall function.

For structured outputs there are `redactError(err)` (message, stack, cause and
attached properties) and `redactDeep(value)` / `redactJson(value)` for SSE frames
and HTTP bodies — the latter also blanks any property _named_ like a secret, which
catches short or oddly formatted values no pattern would match. Every
`KeyvaultError` message is redacted in its constructor.

Two deliberate trade-offs, so they are not surprises:

- **Long hex and base64 runs are masked bluntly.** A 64-character cache digest in
  a debug line gets masked along with a 64-character API key, because we cannot
  tell them apart and only one of those mistakes is expensive. Use
  `redact(text, { generic: false })` or `INKCAST_REDACT_GENERIC=0` where digest
  readability matters more.
- **Masked previews are held out of the shape rules**, or `listProviders()` output
  would collapse to `«redacted»` when printed through the hook. The exemption is
  bounded to a public prefix plus six characters — exactly what `mask()` already
  discloses — so it cannot be used to smuggle a whole key past redaction.

### Keys are never written to the project

Nothing here writes into the project directory, the storyboard, or
`<project>/cache.json`. Storage is the OS keychain or `~/.inkcast/`, never
`projects/`. A key is **held in memory only for the duration of the call that
asked for it**: `getKey()` returns a string and keeps no reference,
`listProviders()` works from masked previews, and `validateKey()` drops the key
when the request settles. The two exceptions are documented where they live and
both are cleared by `lock()`:

- the scrypt-derived key, cached per process so a three-provider run does not pay
  scrypt three times;
- the tracked-value table above.

### Keeping a vault out of git

Two independent guards, because either alone has a hole:

1. Every vault directory we create gets its own `.gitignore` containing `*`. This
   holds even when the default `~/.inkcast/` turns out to sit inside a dotfiles
   repo.
2. A vault path inside a git working tree is **refused** (`vault-in-repo`) unless
   that tree is your home directory (the dotfiles case, covered by 1) or you set
   `INKCAST_VAULT_ALLOW_IN_REPO=1`.

Plus `packages/keyvault/.gitignore`, and `GITIGNORE_RULES` is exported for the
repo-root file.

---

## Threat model

**What this protects against**

| Threat                                                                     | How                                                                                                                  |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Committing a key to the repo                                               | Nothing is ever written to the project; two independent git guards on the vault path; keychain writes no file at all |
| A key in a log, an SSE event, an HTTP body or a stack trace                | `redact()` plus the stdout/stderr hook; redacted error constructors; `redactDeep` for payloads                       |
| A backup or a stray `~/.inkcast` copy                                      | Vault contents are AES-256-GCM under a scrypt-derived key; the file alone is useless                                 |
| Casual disk access — a borrowed laptop, a shared volume, a recovered drive | Mode `0600` in a `0700` directory; on macOS the secret is in the OS keychain, not our files                          |
| Silent tampering with stored keys                                          | Per-entry AEAD with provider-bound AAD; modification raises `tampered`, never a silent fallback                      |
| A key on the command line (visible in `ps`, shell history)                 | Secrets go to `security` on stdin; `promptSecret()` reads without echo                                               |
| Shell injection through a key                                              | No shell is ever spawned (`spawn` with an argv array); keys with control characters are rejected                     |
| Accidentally overwriting a good key with an empty one                      | `setKey()` reads back and compares after a keychain write                                                            |

**What this does not protect against — honestly**

- **An attacker with your logged-in user account.** On macOS your login keychain is
  unlocked while you are logged in, so anything running as you can ask `security`
  for the key. This is the OS's trust boundary, not something we can improve.
- **An attacker who has your vault file _and_ your passphrase.** They have your
  keys. scrypt only makes guessing a weak passphrase expensive; it cannot rescue
  a bad one. Use a long passphrase.
- **A process that can read this process's memory** (a debugger, a core dump, root,
  another process with the right entitlement). Keys are plaintext in memory while
  in use, necessarily — they have to be sent to the provider.
- **Malicious code already inside the pipeline.** Any dependency running in-process
  can call `getKey()`. This is a lock on the filing cabinet, not a sandbox.
- **Which providers you have configured.** Entry names and masked previews are
  readable without the passphrase, by design (see above).
- **Providers you have exported into your shell.** An env var is not encrypted by
  anything; it is visible to every child process. That is the trade for
  environment-first precedence, and `listProviders()` reports `source: 'env'` so
  you can see it.

The realistic threat here is a **breach of the machine or a leak of the repo**, and
the accidental paths — git, backups, logs — are the ones that actually happen. The
design optimises for those.

---

## Rotating a key

1. Mint a new key in the provider's console (`PROVIDER_SPECS[p].console` has the
   URL) — do this _before_ revoking the old one, so nothing breaks mid-render.
2. Store it. `setKey()` overwrites in place and clears the recorded validation
   verdict, so a UI cannot show a green tick for a key that no longer exists:
   ```ts
   await setKey('anthropic', newKey);
   ```
3. Confirm it works before you revoke anything:
   ```ts
   const r = await validateKey('anthropic'); // r.ok must be true
   ```
4. Revoke the old key in the provider's console. **This is the step that actually
   rotates the credential** — removing it from Inkcast only removes local access.
5. If the key had also been exported into your shell or a `.env`, remove it there
   too. `deleteKey()` warns when an environment variable is still set, because
   otherwise it keeps working and looks like the delete failed.

To move a key between backends, read it with the old backend and write it with the
new one, then delete the original:

```ts
const key = await getKey('anthropic', { backend: 'keychain' });
if (key) {
  await setKey('anthropic', key, { backend: 'vault' });
  await deleteKey('anthropic', { backend: 'keychain' });
}
```

**If you suspect a key has leaked, revoke it at the provider.** Deleting it here
does not — anyone who copied it still has a working credential.

---

## Environment variables

| Variable                                                                    | Effect                                                          |
| --------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `REPLICATE_API_TOKEN`, `FAL_KEY` | A key, taking precedence over storage                           |
| `INKCAST_KEYVAULT_BACKEND`                                                  | `keychain` \| `vault` \| `auto` (default)                       |
| `INKCAST_VAULT_PASSPHRASE`                                                  | Vault passphrase                                                |
| `INKCAST_VAULT_PASSPHRASE_FILE`                                             | Read the passphrase from a file instead — preferred on a runner |
| `INKCAST_VAULT_PATH`                                                        | Override `~/.inkcast/vault.json`                                |
| `INKCAST_KEYVAULT_META`                                                     | Override the sidecar path                                       |
| `INKCAST_HOME`                                                              | Override `~/.inkcast`                                           |
| `INKCAST_KEYCHAIN_SERVICE`                                                  | Keychain service name (tests use this for isolation)            |
| `INKCAST_VAULT_ALLOW_IN_REPO=1`                                             | Permit a vault path inside a git working tree                   |
| `INKCAST_KEYVAULT_TRACK=0`                                                  | Do not track literal key values for exact-match redaction       |
| `INKCAST_REDACT_GENERIC=0`                                                  | Do not mask long hex / base64 runs                              |

## Tests

```sh
pnpm --filter @inkcast/keyvault test          # 42 tests, keychain suite skipped
INKCAST_TEST_KEYCHAIN=1 pnpm --filter @inkcast/keyvault test   # + the real `security` CLI
```

Every test runs against a throwaway directory and an explicit `env` object, so it
cannot touch your real vault, keychain, or `~/.inkcast`. The keychain suite is
opt-in because it writes to your login keychain; it uses a random service name per
run and deletes what it creates.
