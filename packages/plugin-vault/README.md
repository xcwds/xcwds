# @xcwds/plugin-vault

Encryption at rest for the sensitive storage groups of an @xcwds app that uses
[`@xcwds/plugin-lock`](../plugin-lock). **Work in progress** ([#79](https://github.com/xcwds/xcwds/issues/79)):
not published yet. Backups of sealed groups (format 3), sealing files ([#149](https://github.com/xcwds/xcwds/issues/149)) and the Privacy
section's wording come next.

```ts
import lock from '@xcwds/plugin-lock';
import vault from '@xcwds/plugin-vault';
export default defineConfig({ brand, plugins: [lock(), vault()] });
```

List it after `@xcwds/plugin-lock` (the build fails otherwise). It takes no options: every storage
entry marked `sensitive` (so its whole group) is sealed. The plugin puts the vault's storage layer
over the app's storage and hands it the lock's passcode: setting a passcode encrypts the sensitive
groups, they open only while the app is unlocked, and turning the lock off writes them back as
plaintext. A vault added to an app that already has a passcode turns on at the next unlock. When
another tab changes the passcode, this tab locks and asks for the new one. App updates wait until
the latest writes are sealed. `app.vault.state` says whether the data is encrypted (`enabled`)
and whether it's open now (`locked`); `app.vault.flush()` resolves once every write is sealed.

The pieces it's built from can also be used on their own:

From `@xcwds/plugin-vault/vault`, `createVault(app.storage)` puts a storage layer over the app's
storage (RFC 0001, decision 11). Once turned on with `enable(key, salt)`, it keeps every sensitive
group sealed as one blob, serves its keys from memory while unlocked, and re-seals after writes,
in order. Locked, sensitive keys read as `undefined` and refuse writes, and migrations wait until
`unlock(key)`. `lock()` still saves writes already made. `disable()` writes the plaintext back.
`drop()` deletes the sealed groups unread, for a forgotten passcode, as does clearing the group
its salt is saved in (`lock` by default). Another tab's re-seal is opened again in each unlocked
tab. `rekey(key, salt)` seals everything again with a key from a new passcode; a tab whose key
another tab's `rekey` replaced locks itself (and calls `onLocked`) rather than seal over it, as
does a tab that was open while another one turned the vault on.

From `@xcwds/plugin-vault/keeper`, `app.lock.keep(passcodeKeeper(vault))` connects it to
`@xcwds/plugin-lock`'s passcode: the lock hands over the passcode once it has checked it, and the
keeper derives the vault's key from it with the vault's own salt. Setting up a passcode turns the
vault on, unlocking opens it (and turns it on, for a vault installed after the passcode was set),
changing the passcode re-keys it with a fresh salt, turning the lock off writes the plaintext
back, and a forgotten passcode's reset deletes the sealed groups unread. The plugin entry does
this for you.

From `@xcwds/plugin-vault/blobs` ([#149](https://github.com/xcwds/xcwds/issues/149)),
`createBlobVault({ sensitive, enabled })` does the same for files: install its `layer` with
`app.blobs.layer(...)` and the blobs of sensitive collections (photos, shared images) are sealed
in IndexedDB. Each blob is sealed in 1 MB chunks, so a photo is never held as a whole second
copy, with a fresh IV per chunk and bound to its collection, id, place and the number of chunks:
chunks changed, moved, reordered, dropped or added don't open. Its size, type and `meta` are
sealed too; the row keeps only a size rounded up to 64 KB and when it was saved. Give it the key
the storage layer accepted with `unlock(key)`, and `lock()` to forget it. Locked, a sensitive
collection reads as empty and refuses saves, but deleting and clearing it still work, so a reset
clears what it can't read. `sealAll(progress)` seals the blobs already saved once the vault is
on, and `openAll(progress)` opens them back before it's turned off; both go one blob at a time,
leave one that fails as it was, and can run again to finish.

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
