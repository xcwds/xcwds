# @xcwds/plugin-vault

Encryption at rest for the sensitive storage groups of an @xcwds app that uses
[`@xcwds/plugin-lock`](../plugin-lock). **Work in progress** ([#79](https://github.com/xcwds/xcwds/issues/79)):
not published yet, and not a plugin you can install yet.

So far it holds the sealing and the storage layer the plugin will be built on.

From `@xcwds/plugin-vault/vault`, `createVault(app.storage)` puts a storage layer over the app's
storage (RFC 0001, decision 11). Once turned on with `enable(key, salt)`, it keeps every sensitive
group sealed as one blob, serves its keys from memory while unlocked, and re-seals after writes,
in order. Locked, sensitive keys read as `undefined` and refuse writes, and migrations wait until
`unlock(key)`. `lock()` still saves writes already made. `disable()` writes the plaintext back.
`drop()` deletes the sealed groups unread, for a forgotten passcode, as does clearing the group
its salt is saved in (`lock` by default). Another tab's re-seal is opened again in each unlocked
tab. Connecting it to `@xcwds/plugin-lock`'s passcode comes next.

From `@xcwds/plugin-vault/seal`:

- `deriveKey(passcode, salt, iterations?)` turns the lock's passcode into an AES-GCM-256 key with
  PBKDF2-SHA-256 (600,000 iterations by default). The key is non-extractable, so it can live in
  memory while the app is unlocked but can never be written anywhere. Give it its own salt from
  `newSalt()`, never the lock verifier's.
- `seal(key, text, context)` encrypts with a fresh random IV and binds the result to `context` (a
  storage group's name), so a sealed value moved to another group won't open. `open` returns the
  text, or `undefined` for a wrong key, another context or changed data.
- `sealWithPasscode` and `openWithPasscode` do the same with a fresh salt stored beside the value,
  for encrypted backups that import on another device with the passcode.
- `parseSealed` and `parsePasscodeSealed` check a saved value's shape, and refuse iteration counts
  under 100,000 or over 10,000,000 so an edited value can neither make guessing cheap nor freeze
  the page.

Everything uses WebCrypto (`globalThis.crypto.subtle`) only when a function runs, never at import
time, and makes no network requests.
