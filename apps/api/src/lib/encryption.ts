import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET;

if (!ENCRYPTION_SECRET) {
  throw new Error('ENCRYPTION_SECRET environment variable is not set');
}

// Derive a 32-byte key from the secret using scrypt
// Using a constant salt as we need to derive the same key every time
const KEY = crypto.scryptSync(ENCRYPTION_SECRET, 'qacc-salt', 32);

/**
 * Encrypts text using AES-256-GCM
 * @param text The plain text to encrypt
 * @returns A string in the format "iv:authTag:encrypted" (all components base64 encoded)
 */
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag().toString('base64');
  const ivBase64 = iv.toString('base64');

  return `${ivBase64}:${authTag}:${encrypted}`;
}

/**
 * Decrypts text using AES-256-GCM
 * @param encryptedText A string in the format "iv:authTag:encrypted" (all components base64 encoded)
 * @returns The decrypted plain text
 */
export function decrypt(encryptedText: string): string {
  const [ivBase64, authTagBase64, encrypted] = encryptedText.split(':');

  if (!ivBase64 || !authTagBase64 || !encrypted) {
    throw new Error('Invalid encrypted text format');
  }

  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  // If the result looks like another encrypted string, try decrypting recursively
  // format is "ivBase64:authTagBase64:encrypted"
  if (decrypted.split(':').length === 3) {
    try {
      return decrypt(decrypted);
    } catch (e) {
      // If nested decryption fails, it's just a string that happens to have colons
      return decrypted;
    }
  }

  return decrypted;
}
