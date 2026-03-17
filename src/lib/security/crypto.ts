import crypto from 'node:crypto'

const IV_LENGTH = 12

function getEncryptionKey() {
  const secret = process.env.APP_ENCRYPTION_KEY

  if (!secret) {
    throw new Error('APP_ENCRYPTION_KEY is missing.')
  }

  return crypto.createHash('sha256').update(secret).digest()
}

export function encryptSecret(plainText: string) {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

export function decryptSecret(payload: string | null | undefined) {
  if (!payload) {
    return null
  }

  const buffer = Buffer.from(payload, 'base64')
  const iv = buffer.subarray(0, IV_LENGTH)
  const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + 16)
  const encrypted = buffer.subarray(IV_LENGTH + 16)
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv)
  decipher.setAuthTag(tag)

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
