import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

const options = { memory: 65536, passes: 3, parallelism: 1, tagLength: 32 };
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    argon2(
      'argon2id',
      { ...options, message: Buffer.from(password, 'utf8'), nonce: salt },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}
// A non-matching digest with the same work factor avoids skipping password work for unknown accounts.
const base64 = (value: Buffer) => value.toString('base64').replace(/=+$/, '');
export const dummyPasswordHash =
  '$argon2id$v=19$m=65536,t=3,p=1$' + base64(Buffer.alloc(16)) + '$' + base64(Buffer.alloc(32));
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `$argon2id$v=19$m=65536,t=3,p=1$${base64(salt)}$${base64(hash)}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const match =
    /^\$argon2id\$v=19\$m=65536,t=3,p=1\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/.exec(encoded);
  if (!match) {
    await derive(password, Buffer.alloc(16));
    return false;
  }
  const actual = await derive(password, Buffer.from(match[1], 'base64'));
  const expected = Buffer.from(match[2], 'base64');
  return timingSafeEqual(actual, expected);
}
