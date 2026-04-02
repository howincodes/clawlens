import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

let encryptionKey: Buffer | null = null;

function getKey(): Buffer {
  if (encryptionKey) return encryptionKey;

  const keyEnv = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!keyEnv) {
    throw new Error(
      'CREDENTIAL_ENCRYPTION_KEY environment variable is required. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }

  // Accept hex (64 chars) or base64 (44 chars)
  let keyBuffer: Buffer;
  if (/^[0-9a-f]{64}$/i.test(keyEnv)) {
    keyBuffer = Buffer.from(keyEnv, 'hex');
  } else {
    keyBuffer = Buffer.from(keyEnv, 'base64');
  }

  if (keyBuffer.length !== 32) {
    throw new Error(
      `CREDENTIAL_ENCRYPTION_KEY must be exactly 32 bytes. Got ${keyBuffer.length} bytes. ` +
      'Provide 64 hex characters or 44 base64 characters.'
    );
  }

  encryptionKey = keyBuffer;
  return encryptionKey;
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Returns base64(iv[12] + authTag[16] + ciphertext).
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // iv (12) + authTag (16) + ciphertext
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString('base64');
}

/**
 * Decrypt a value produced by encrypt().
 * Input: base64(iv[12] + authTag[16] + ciphertext).
 */
export function decrypt(ciphertext: string): string {
  const key = getKey();
  const combined = Buffer.from(ciphertext, 'base64');

  if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid ciphertext: too short');
  }

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Check if encryption is configured (key is set in env).
 * Does NOT throw — useful for graceful degradation during development.
 */
export function isEncryptionConfigured(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Reset the cached key (for testing only).
 */
export function _resetKeyCache(): void {
  encryptionKey = null;
}
