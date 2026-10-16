const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) {
    throw new Error("Stored registration link is invalid.");
  }
  return Uint8Array.from(value.match(/.{2}/g)!, (byte) => Number.parseInt(byte, 16));
}

async function encryptionKey(serviceKey: string): Promise<CryptoKey> {
  const keyBytes = await crypto.subtle.digest("SHA-256", encoder.encode(serviceKey));
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptRegistrationToken(token: string, serviceKey: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(serviceKey),
    encoder.encode(token),
  );
  return `v1:${toHex(iv)}:${toHex(new Uint8Array(encrypted))}`;
}

export async function decryptRegistrationToken(value: string, serviceKey: string): Promise<string> {
  const match = /^v1:([0-9a-f]{24}):([0-9a-f]{160})$/i.exec(value);
  if (!match) throw new Error("Stored registration link has an unsupported format.");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromHex(match[1]) },
    await encryptionKey(serviceKey),
    fromHex(match[2]),
  );
  const token = new TextDecoder().decode(plaintext);
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("Stored registration link is invalid.");
  return token;
}

export async function hashRegistrationToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return toHex(new Uint8Array(digest));
}

export function createRegistrationToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}
