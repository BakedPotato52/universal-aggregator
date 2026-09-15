import { describe, it, expect } from 'vitest';
import { BankCrypto } from '../src/upi/crypto.js';

describe('BankCrypto', () => {
  const secretKey = 'my_super_secret_bank_key_12345';

  it('should generate and verify HMAC-SHA256 signatures correctly', () => {
    const payload = {
      orderId: 'ORD_12345',
      amount: 500,
      bankRef: 'RRN998877',
    };

    const signature = BankCrypto.generateHmacSha256(payload, secretKey);
    expect(signature).toBeDefined();
    expect(signature.length).toBe(64); // 32-byte hex

    // Valid signature
    const isValid = BankCrypto.verifyHmacSha256(payload, secretKey, signature);
    expect(isValid).toBe(true);

    // Tampered payload
    const tampered = { ...payload, amount: 999 };
    const isTamperedValid = BankCrypto.verifyHmacSha256(tampered, secretKey, signature);
    expect(isTamperedValid).toBe(false);

    // Wrong secret key
    const isWrongKeyValid = BankCrypto.verifyHmacSha256(payload, 'wrong_key', signature);
    expect(isWrongKeyValid).toBe(false);
  });

  it('should calculate SHA256 checksums', () => {
    const data = 'MID100|ORD123|500.00|00|RRN7788';
    const checksum = BankCrypto.generateSha256Checksum(data);
    expect(checksum).toBeDefined();
    expect(checksum.length).toBe(64);
  });

  it('should encrypt and decrypt payloads using AES-256-CBC', () => {
    const originalText = JSON.stringify({
      customerName: 'Aarav Sharma',
      accountNumber: '998877665544',
      amount: 1500.75,
    });

    const { encrypted, iv } = BankCrypto.encryptAes256Cbc(originalText, secretKey);
    expect(encrypted).toBeDefined();
    expect(iv).toBeDefined();

    const decrypted = BankCrypto.decryptAes256Cbc(encrypted, secretKey, iv);
    expect(decrypted).toBe(originalText);
    expect(JSON.parse(decrypted)).toEqual(JSON.parse(originalText));
  });

  it('should encrypt and decrypt payloads using AES-256-GCM', () => {
    const originalText = 'HDFC_DIRECT_UPI_SETTLEMENT_PAYLOAD_OK';

    const { ciphertext, iv, authTag } = BankCrypto.encryptAes256Gcm(originalText, secretKey);
    expect(ciphertext).toBeDefined();
    expect(iv).toBeDefined();
    expect(authTag).toBeDefined();

    const decrypted = BankCrypto.decryptAes256Gcm(ciphertext, secretKey, iv, authTag);
    expect(decrypted).toBe(originalText);
  });
});
