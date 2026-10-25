import db from '../database/data-source';
import { createUserInput, UsersService } from '../modules/auth/services/users.service';

async function run(): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password)
    throw new Error(
      'Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD locally before running this command',
    );
  const validation = createUserInput.safeParse({ email, password, roles: ['ADMIN'] });
  if (!validation.success) {
    for (const issue of validation.error.issues) {
      console.error(`Invalid bootstrap ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exitCode = 1;
    return;
  }
  await db.initialize();
  try {
    await new UsersService(db).create({ email, password, roles: ['ADMIN'] }, true);
    console.log(
      'Initial admin created. Credentials were not printed. Remove bootstrap variables from your local environment.',
    );
  } finally {
    await db.destroy();
  }
}
void run().catch(() => {
  console.error(
    'Admin bootstrap failed. Check inputs, migrations, or whether an admin already exists. Existing accounts were not overwritten.',
  );
  process.exitCode = 1;
});
