/**
 * Encrypts text using AES-256-GCM
 * @param text The plain text to encrypt
 * @returns A string in the format "iv:authTag:encrypted" (all components base64 encoded)
 */
export declare function encrypt(text: string): string;
/**
 * Decrypts text using AES-256-GCM
 * @param encryptedText A string in the format "iv:authTag:encrypted" (all components base64 encoded)
 * @returns The decrypted plain text
 */
export declare function decrypt(encryptedText: string): string;
//# sourceMappingURL=encryption.d.ts.map