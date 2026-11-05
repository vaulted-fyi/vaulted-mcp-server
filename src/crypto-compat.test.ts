import {
  exportKey,
  importKey,
  unwrapKeyWithPassphrase,
  wrapKeyWithPassphrase,
} from "@vaulted/crypto";

// Known-answer vectors pin interoperability with links created elsewhere (vaulted.fyi, the CLI,
// older releases of this server). Do not regenerate them: a vector that no longer unwraps means
// links already shared in the wild have stopped opening.
const RAW_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const PASSPHRASE = "correct horse battery staple";

// Wrapped by the npm-published @vaulted/crypto@1.0.0 (PBKDF2-SHA256, 100k iterations).
const VECTOR_100K = {
  wrappedKey: "-ImnvxXgniZa6NQXKwPt0TE69EQZ2QHCO10pdw9lyzd051VScqhhIQ",
  salt: "QKuy-Aem8ZU2eWZJuM2afw",
};

// Wrapped by the npm-published @vaulted/crypto@1.1.0 (PBKDF2-SHA256, 600k iterations).
const VECTOR_600K = {
  wrappedKey: "_BQbvA9P9MNNxbRKJTsQ6Zpv2Bv5noBO8UnvH8NJiwqOVT6qNcfH2g",
  salt: "CkD2firpO0ykTW0IoXOJ1A",
};

async function unwrapAtIterations(wrappedKey: string, salt: string, iterations: number) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(PASSPHRASE),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const wrappingKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: Buffer.from(salt, "base64url"), iterations, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-KW", length: 256 },
    false,
    ["unwrapKey"],
  );
  return crypto.subtle.unwrapKey(
    "raw",
    Buffer.from(wrappedKey, "base64url"),
    wrappingKey,
    "AES-KW",
    "AES-GCM",
    true,
    ["encrypt", "decrypt"],
  );
}

// A 600k-iteration PBKDF2 derivation takes over a second by design; under a parallel test run it
// can exceed the 5s default.
describe("passphrase-wrapped key interoperability", { timeout: 30_000 }, () => {
  it("unwraps a 600k-iteration fragment created by vaulted.fyi", async () => {
    const key = await unwrapKeyWithPassphrase(VECTOR_600K.wrappedKey, VECTOR_600K.salt, PASSPHRASE);

    expect(await exportKey(key)).toBe(RAW_KEY);
  });

  it("unwraps a legacy 100k-iteration fragment", async () => {
    const key = await unwrapKeyWithPassphrase(VECTOR_100K.wrappedKey, VECTOR_100K.salt, PASSPHRASE);

    expect(await exportKey(key)).toBe(RAW_KEY);
  });

  it("wraps new keys at 600k iterations so vaulted.fyi can open them", async () => {
    const { wrappedKey, salt } = await wrapKeyWithPassphrase(await importKey(RAW_KEY), PASSPHRASE);

    const key = await unwrapAtIterations(wrappedKey, salt, 600_000);

    expect(await exportKey(key)).toBe(RAW_KEY);
  });
});
