import { hashPassword, verifyPassword } from '../../src/modules/auth/security/password';

describe('Argon2id password storage', () => {
  it('uses fresh salts and verifies without retaining the plaintext', async () => {
    const password = 'Synthetic test password 123!';
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    expect(first).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain(password);
    await expect(verifyPassword(password, first)).resolves.toBe(true);
    await expect(verifyPassword('wrong', first)).resolves.toBe(false);
    await expect(verifyPassword(password, '$argon2id$malformed')).resolves.toBe(false);
  }, 15000);
});
