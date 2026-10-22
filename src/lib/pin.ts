// Profile PINs are stored as a salted SHA-256 hash. This keeps the PIN itself out of
// storage, but like Nuvio's it's a convenience lock, not protection against someone
// with access to this device's files.

async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createPin(pin: string) {
  const salt = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { salt, hash: await sha256(`${salt}:${pin}`) };
}

export async function verifyPin(pin: string, stored: { salt: string; hash: string }) {
  return (await sha256(`${stored.salt}:${pin}`)) === stored.hash;
}

export const isValidPin = (pin: string) => /^\d{4}$/.test(pin);
