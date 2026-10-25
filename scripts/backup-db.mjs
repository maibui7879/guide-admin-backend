import { createRequire } from 'node:module';
import { mkdir, readFile, rename, stat, chmod, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
class BackupError extends Error {}
const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
requireApi('dotenv').config({ path: resolve('.env'), quiet: true });
const { Client } = requireApi('pg');
const envName = process.env.NODE_ENV ?? 'development';
function settings(value) {
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new BackupError('PostgreSQL URL required');
  const local =
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && envName !== 'production';
  const insecure = envName === 'development' && process.env.DATABASE_SSL_INSECURE === 'true';
  const ssl = local ? false : { rejectUnauthorized: !insecure };
  const pgEnv = {
    ...process.env,
    PGHOST: url.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE: local ? 'disable' : insecure ? 'require' : 'verify-full',
    PGCONNECT_TIMEOUT: '10',
    PGAPPNAME: 'atlas-backup',
  };
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
  return {
    url,
    pgEnv,
    client: new Client({
      connectionString: url.href,
      ssl,
      connectionTimeoutMillis: 10000,
      statement_timeout: 30000,
    }),
  };
}
async function tool(binary, args, pgEnv, file) {
  let command = process.env[binary === 'pg_dump' ? 'PG_DUMP_BIN' : 'PG_RESTORE_BIN'] ?? binary,
    argv = args;
  if (process.env.BACKUP_TOOL_MODE === 'docker') {
    command = 'docker';
    argv = [
      'run',
      '--rm',
      '--network',
      'host',
      ...[
        'PGHOST',
        'PGPORT',
        'PGUSER',
        'PGPASSWORD',
        'PGDATABASE',
        'PGSSLMODE',
        'PGCONNECT_TIMEOUT',
        'PGAPPNAME',
      ].flatMap((key) => ['--env', key]),
      '--mount',
      `type=bind,source=${dirname(file)},target=/backup`,
      process.env.BACKUP_POSTGRES_IMAGE ?? 'postgres:17-alpine',
      binary,
      ...args.map((a) => (a === file ? '/backup/' + basename(file) : a)),
    ];
  }
  if (process.env.BACKUP_TOOL_MODE === 'wsl') {
    if (!/^[A-Za-z]:[\\/]/.test(file))
      throw new BackupError('WSL backup requires a local Windows drive path');
    const linuxFile = '/mnt/' + file[0].toLowerCase() + file.slice(2).replaceAll('\\', '/');
    const keys = [
      'PGHOST',
      'PGPORT',
      'PGUSER',
      'PGPASSWORD',
      'PGDATABASE',
      'PGSSLMODE',
      'PGCONNECT_TIMEOUT',
      'PGAPPNAME',
    ];
    pgEnv = {
      ...pgEnv,
      WSLENV: [pgEnv.WSLENV ?? '', ...keys.map((key) => key + '/u')].filter(Boolean).join(':'),
    };
    command = 'wsl.exe';
    argv = [
      '-d',
      process.env.BACKUP_WSL_DISTRO ?? 'Ubuntu',
      '--',
      binary,
      ...args.map((a) => (a === file ? linuxFile : a)),
    ];
  }
  await new Promise((ok, fail) => {
    const child = spawn(command, argv, {
      env: pgEnv,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    // Child stderr can contain host/user/database details; report only a generic failure.
    child.stderr.resume();
    const timer = setTimeout(() => {
      child.kill();
      fail(new BackupError(`${binary} timed out`));
    }, 300000);
    child.once('error', () => {
      clearTimeout(timer);
      fail(
        new BackupError(
          `${binary} unavailable; install matching PostgreSQL client tools or set BACKUP_TOOL_MODE=docker`,
        ),
      );
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      code === 0
        ? ok()
        : fail(
            new BackupError(
              `${binary} failed; verify client version, connection privileges and tool availability`,
            ),
          );
    });
  });
}
const quote = (s) => '"' + s.replaceAll('"', '""') + '"';
async function counts(client) {
  const { rows: tables } = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
  );
  if (!tables.length) return {};
  const sql = tables
    .map(
      ({ tablename }) =>
        `SELECT '${tablename.replaceAll("'", "''")}' AS name,count(*)::text AS total FROM public.${quote(tablename)}`,
    )
    .join(' UNION ALL ');
  const { rows } = await client.query(sql + ' ORDER BY name');
  return Object.fromEntries(rows.map((r) => [r.name, r.total]));
}
async function checksum(file) {
  const hash = createHash('sha256');
  for await (const part of createReadStream(file)) hash.update(part);
  return hash.digest('hex');
}
async function backup() {
  if (!process.env.DATABASE_URL) throw new BackupError('DATABASE_URL is required');
  const { client, pgEnv } = settings(process.env.DATABASE_URL);
  const directory = resolve(process.env.BACKUP_DIR ?? '.cache/backups');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = resolve(
    directory,
    'atlas-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID() + '.dump',
  );
  const partial = file + '.partial';
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const {
      rows: [snapshot],
    } = await client.query('SELECT pg_export_snapshot() AS id');
    const expected = await counts(client);
    await tool(
      'pg_dump',
      [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '--schema=public',
        '--snapshot=' + snapshot.id,
        '--file',
        partial,
      ],
      pgEnv,
      partial,
    );
    await client.query('COMMIT');
    await rename(partial, file);
    await chmod(file, 0o600);
    const manifest = {
      createdAt: new Date().toISOString(),
      sha256: await checksum(file),
      byteSize: (await stat(file)).size,
      tables: expected,
      scope: 'public schema only; object storage and platform roles require separate backups',
    };
    await writeFile(file + '.json', JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
    console.log('Backup and verification manifest saved: ' + file);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}
async function restoreTest() {
  const file = resolve(process.argv[3] ?? '');
  if (!process.argv[3] || !process.env.RESTORE_TEST_DATABASE_URL || !process.env.DATABASE_URL)
    throw new BackupError('Provide dump path, DATABASE_URL and RESTORE_TEST_DATABASE_URL');
  const source = settings(process.env.DATABASE_URL),
    target = settings(process.env.RESTORE_TEST_DATABASE_URL);
  const database = decodeURIComponent(target.url.pathname.slice(1));
  if (
    !/^atlas_restore_[a-z0-9_]+$/.test(database) ||
    [source.url.hostname, source.url.port || '5432', source.url.pathname].join('|') ===
      [target.url.hostname, target.url.port || '5432', target.url.pathname].join('|')
  )
    throw new BackupError('Restore target must be a separate empty database named atlas_restore_*');
  const manifest = JSON.parse(await readFile(file + '.json', 'utf8'));
  if ((await checksum(file)) !== manifest.sha256) throw new BackupError('Backup checksum mismatch');
  await target.client.connect();
  try {
    const {
      rows: [existing],
    } = await target.client.query(
      "SELECT count(*)::int AS total FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','S')",
    );
    if (existing.total !== 0) throw new BackupError('Restore refused: target is not empty');
    await tool(
      'pg_restore',
      [
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-privileges',
        '--single-transaction',
        '--exit-on-error',
        '--dbname',
        database,
        file,
      ],
      target.pgEnv,
      file,
    );
    const actual = await counts(target.client);
    if (JSON.stringify(actual) !== JSON.stringify(manifest.tables))
      throw new BackupError('Restored row counts do not match the exported snapshot');
    await target.client.query('ANALYZE');
    console.log(
      'Restore verification passed: checksum and all public-table row counts match. Review grants, object storage and application health before a real recovery.',
    );
  } finally {
    await target.client.end();
  }
}
try {
  if (process.argv[2] === 'restore-test') await restoreTest();
  else if (!process.argv[2] || process.argv[2] === 'backup') await backup();
  else throw new BackupError('Use backup or restore-test <dump>');
} catch (error) {
  console.error(
    error instanceof BackupError
      ? error.message
      : 'Backup/restore failed; check DB access, privileges and matching PostgreSQL client tools',
  );
  process.exitCode = 1;
}
