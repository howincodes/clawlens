import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encrypt, decrypt, isEncryptionConfigured, _resetKeyCache } from '../src/services/encryption.js';
import crypto from 'node:crypto';

describe('Encryption Service', () => {
  const TEST_KEY_HEX = crypto.randomBytes(32).toString('hex');

  beforeEach(() => {
    _resetKeyCache();
    process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY_HEX;
  });

  afterEach(() => {
    _resetKeyCache();
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  });

  describe('encrypt + decrypt roundtrip', () => {
    it('should roundtrip a simple string', () => {
      const plaintext = 'sk-ant-ort01-test-refresh-token';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should roundtrip a full credential JSON', () => {
      const creds = JSON.stringify({
        claudeAiOauth: {
          accessToken: 'sk-ant-oat01-test',
          refreshToken: 'sk-ant-ort01-test',
          expiresAt: 1775169902877,
          scopes: ['user:inference'],
          subscriptionType: 'team',
        },
      });
      expect(decrypt(encrypt(creds))).toBe(creds);
    });

    it('should roundtrip empty string', () => {
      expect(decrypt(encrypt(''))).toBe('');
    });

    it('should roundtrip unicode', () => {
      const text = 'HOWIN TEAM AI 4 — credential 🔐';
      expect(decrypt(encrypt(text))).toBe(text);
    });

    it('should roundtrip long text', () => {
      const text = 'a'.repeat(10000);
      expect(decrypt(encrypt(text))).toBe(text);
    });
  });

  describe('ciphertext properties', () => {
    it('should produce different ciphertexts for same plaintext (random IV)', () => {
      const plaintext = 'same-input';
      const c1 = encrypt(plaintext);
      const c2 = encrypt(plaintext);
      expect(c1).not.toBe(c2);
      // But both decrypt to the same value
      expect(decrypt(c1)).toBe(plaintext);
      expect(decrypt(c2)).toBe(plaintext);
    });

    it('should produce valid base64 output', () => {
      const encrypted = encrypt('test');
      expect(() => Buffer.from(encrypted, 'base64')).not.toThrow();
      // Minimum length: 12 (iv) + 16 (tag) + 1 (at least 1 byte ciphertext)
      expect(Buffer.from(encrypted, 'base64').length).toBeGreaterThanOrEqual(28);
    });
  });

  describe('tamper detection', () => {
    it('should throw on tampered ciphertext', () => {
      const encrypted = encrypt('sensitive-data');
      const buf = Buffer.from(encrypted, 'base64');
      // Flip a byte in the ciphertext portion
      buf[buf.length - 1] ^= 0xff;
      const tampered = buf.toString('base64');
      expect(() => decrypt(tampered)).toThrow();
    });

    it('should throw on tampered auth tag', () => {
      const encrypted = encrypt('sensitive-data');
      const buf = Buffer.from(encrypted, 'base64');
      // Flip a byte in the auth tag (bytes 12-27)
      buf[15] ^= 0xff;
      const tampered = buf.toString('base64');
      expect(() => decrypt(tampered)).toThrow();
    });

    it('should throw on truncated ciphertext', () => {
      expect(() => decrypt('dG9vLXNob3J0')).toThrow('too short');
    });

    it('should throw on empty string', () => {
      expect(() => decrypt('')).toThrow('too short');
    });
  });

  describe('key validation', () => {
    it('should throw when key is missing', () => {
      _resetKeyCache();
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
      expect(() => encrypt('test')).toThrow('CREDENTIAL_ENCRYPTION_KEY');
    });

    it('should throw when key is wrong length', () => {
      _resetKeyCache();
      process.env.CREDENTIAL_ENCRYPTION_KEY = 'abcdef';
      expect(() => encrypt('test')).toThrow('32 bytes');
    });

    it('should accept hex key (64 chars)', () => {
      _resetKeyCache();
      process.env.CREDENTIAL_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
      expect(() => encrypt('test')).not.toThrow();
    });

    it('should accept base64 key (44 chars)', () => {
      _resetKeyCache();
      process.env.CREDENTIAL_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
      expect(() => encrypt('test')).not.toThrow();
    });

    it('should not decrypt with a different key', () => {
      const encrypted = encrypt('secret');
      _resetKeyCache();
      process.env.CREDENTIAL_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
      expect(() => decrypt(encrypted)).toThrow();
    });
  });

  describe('isEncryptionConfigured', () => {
    it('should return true when key is set', () => {
      expect(isEncryptionConfigured()).toBe(true);
    });

    it('should return false when key is missing', () => {
      _resetKeyCache();
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
      expect(isEncryptionConfigured()).toBe(false);
    });
  });
});
