import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;  // 12 bytes is the recommended IV length for GCM
const AUTH_TAG_LENGTH = 16; // GCM auth tags are 16 bytes

function getKey(): Buffer {
    const hex = process.env.ENCRYPTION_KEY;

    if (!hex) {
        throw new Error(
            'ENCRYPTION_KEY is missing from environment variables. ' +
            'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
        );
    }

    const key = Buffer.from(hex, 'hex');

    if (key.length !== 32) {
        throw new Error(
            `ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters). Got ${key.length} bytes.`
        );
    }

    return key;
}

// Encrypts a plaintext string using AES-256-GCM.
// Returns a colon-separated hex string: iv:authTag:ciphertext

export function encrypt(plaintext: string): string {
    const key = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}



// Decrypts a colon-separated hex string back to plaintext.
// Throws on corrupted data — do NOT catch this silently.

export function decrypt(encryptedText: string): string {
    const key = getKey();
    const parts = encryptedText.split(':');

    if (parts.length !== 3) {
        throw new Error(
            'Invalid encrypted token format. Expected iv:authTag:ciphertext'
        );
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const ciphertext = Buffer.from(parts[2], 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),  // throws if auth tag doesn't match (tampered data)
    ]);

    return decrypted.toString('utf8');
}
