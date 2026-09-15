import crypto from 'crypto';

export class BankCrypto {
  /**
   * Generates HMAC-SHA256 signature for payload verification
   */
  public static generateHmacSha256(payload: string | object, secretKey: string): string {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return crypto.createHmac('sha256', secretKey).update(data).digest('hex');
  }

  /**
   * Verifies an incoming HMAC-SHA256 signature using timing-safe comparison
   */
  public static verifyHmacSha256(
    payload: string | object,
    secretKey: string,
    providedSignature: string
  ): boolean {
    try {
      const expectedSignature = this.generateHmacSha256(payload, secretKey);
      const expectedBuffer = Buffer.from(expectedSignature, 'hex');
      const providedBuffer = Buffer.from(providedSignature, 'hex');

      if (expectedBuffer.length !== providedBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
    } catch {
      return false;
    }
  }

  /**
   * Generates SHA-256 checksum string for bank payload verification
   * (e.g., checksum = SHA256(mid + "|" + orderId + "|" + amount + "|" + secret))
   */
  public static generateSha256Checksum(concatenatedString: string): string {
    return crypto.createHash('sha256').update(concatenatedString).digest('hex');
  }

  /**
   * Encrypts plaintext using AES-256-CBC (standard for ICICI / HDFC composite APIs)
   */
  public static encryptAes256Cbc(
    plaintext: string,
    key: string,
    iv?: Buffer
  ): { encrypted: string; iv: string } {
    // Ensure 32-byte key for AES-256
    const keyBuffer = crypto.createHash('sha256').update(key).digest();
    const ivBuffer = iv || crypto.randomBytes(16);

    const cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, ivBuffer);
    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    return {
      encrypted,
      iv: ivBuffer.toString('hex'),
    };
  }

  /**
   * Decrypts ciphertext using AES-256-CBC
   */
  public static decryptAes256Cbc(encryptedBase64: string, key: string, ivHex: string): string {
    const keyBuffer = crypto.createHash('sha256').update(key).digest();
    const ivBuffer = Buffer.from(ivHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, ivBuffer);
    let decrypted = decipher.update(encryptedBase64, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Encrypts plaintext using AES-256-GCM (Authenticated Encryption)
   */
  public static encryptAes256Gcm(
    plaintext: string,
    key: string
  ): { ciphertext: string; iv: string; authTag: string } {
    const keyBuffer = crypto.createHash('sha256').update(key).digest();
    const iv = crypto.randomBytes(12); // 12-byte IV standard for GCM

    const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
    let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
    ciphertext += cipher.final('base64');
    const authTag = cipher.getAuthTag().toString('hex');

    return {
      ciphertext,
      iv: iv.toString('hex'),
      authTag,
    };
  }

  /**
   * Decrypts ciphertext using AES-256-GCM
   */
  public static decryptAes256Gcm(
    ciphertextBase64: string,
    key: string,
    ivHex: string,
    authTagHex: string
  ): string {
    const keyBuffer = crypto.createHash('sha256').update(key).digest();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertextBase64, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Signs payload using RSA Private Key (SHA256withRSA)
   */
  public static signRsaSha256(payload: string, privateKeyPem: string): string {
    const sign = crypto.createSign('SHA256');
    sign.update(payload);
    sign.end();
    return sign.sign(privateKeyPem, 'base64');
  }

  /**
   * Verifies RSA SHA256 Signature using Bank Public Key
   */
  public static verifyRsaSha256(
    payload: string,
    signatureBase64: string,
    publicKeyPem: string
  ): boolean {
    try {
      const verify = crypto.createVerify('SHA256');
      verify.update(payload);
      verify.end();
      return verify.verify(publicKeyPem, signatureBase64, 'base64');
    } catch {
      return false;
    }
  }
}
