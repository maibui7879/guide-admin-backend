import { MigrationInterface, QueryRunner } from 'typeorm';

export class Identity1792800002000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`CREATE TABLE users (
      id uuid CONSTRAINT pk_users PRIMARY KEY,email varchar(254) NOT NULL,password_hash varchar(512) NOT NULL,
      is_active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_users_email UNIQUE(email),CONSTRAINT ck_users_email CHECK(email=lower(email)))`);
    await r.query('CREATE TABLE roles (code varchar(32) CONSTRAINT pk_roles PRIMARY KEY)');
    await r.query(
      'CREATE TABLE permissions (code varchar(64) CONSTRAINT pk_permissions PRIMARY KEY)',
    );
    await r.query(`CREATE TABLE user_roles(user_id uuid NOT NULL,role_code varchar(32) NOT NULL,
      CONSTRAINT pk_user_roles PRIMARY KEY(user_id,role_code),
      CONSTRAINT fk_user_roles_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_user_roles_role FOREIGN KEY(role_code) REFERENCES roles(code) ON DELETE RESTRICT)`);
    await r.query('CREATE INDEX ix_user_roles_role ON user_roles(role_code)');
    await r.query(`CREATE TABLE role_permissions(role_code varchar(32) NOT NULL,permission_code varchar(64) NOT NULL,
      CONSTRAINT pk_role_permissions PRIMARY KEY(role_code,permission_code),
      CONSTRAINT fk_role_permissions_role FOREIGN KEY(role_code) REFERENCES roles(code) ON DELETE CASCADE,
      CONSTRAINT fk_role_permissions_permission FOREIGN KEY(permission_code) REFERENCES permissions(code) ON DELETE CASCADE)`);
    await r.query(
      'CREATE INDEX ix_role_permissions_permission ON role_permissions(permission_code)',
    );
    await r.query(`CREATE TABLE user_game_access(user_id uuid NOT NULL,game_id uuid NOT NULL,
      CONSTRAINT pk_user_game_access PRIMARY KEY(user_id,game_id),
      CONSTRAINT fk_user_game_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_user_game_game FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE)`);
    await r.query('CREATE INDEX ix_user_game_game ON user_game_access(game_id)');
    await r.query(`CREATE TABLE sessions(id uuid CONSTRAINT pk_sessions PRIMARY KEY,user_id uuid NOT NULL,
      token_hash varchar(64) NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),last_seen_at timestamptz NOT NULL DEFAULT now(),
      absolute_expires_at timestamptz NOT NULL,idle_expires_at timestamptz NOT NULL,revoked_at timestamptz,
      CONSTRAINT fk_sessions_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT uq_sessions_token UNIQUE(token_hash),CONSTRAINT ck_sessions_expiry CHECK(idle_expires_at<=absolute_expires_at))`);
    await r.query('CREATE INDEX ix_sessions_user ON sessions(user_id)');
    await r.query('CREATE INDEX ix_sessions_expiry ON sessions(absolute_expires_at)');
    await r.query(`CREATE TABLE login_buckets(key varchar(64) CONSTRAINT pk_login_buckets PRIMARY KEY,
      window_started_at timestamptz NOT NULL,attempts integer NOT NULL,CONSTRAINT ck_login_attempts CHECK(attempts>0))`);
    await r.query('CREATE INDEX ix_login_buckets_window ON login_buckets(window_started_at)');
    const permissions = [
      'catalog:write',
      'catalog:draft:write',
      'users:manage',
      'content:write',
      'content:review',
      'content:publish',
    ];
    for (const p of permissions) await r.query('INSERT INTO permissions(code) VALUES($1)', [p]);
    for (const [role, codes] of Object.entries({
      ADMIN: permissions,
      EDITOR: ['catalog:draft:write', 'content:write'],
      REVIEWER: ['content:review'],
    })) {
      await r.query('INSERT INTO roles(code) VALUES($1)', [role]);
      for (const code of codes)
        await r.query('INSERT INTO role_permissions(role_code,permission_code) VALUES($1,$2)', [
          role,
          code,
        ]);
    }
    for (const table of [
      'users',
      'roles',
      'permissions',
      'user_roles',
      'role_permissions',
      'user_game_access',
      'sessions',
      'login_buckets',
    ]) {
      await r.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    }
  }
  async down(r: QueryRunner): Promise<void> {
    for (const table of [
      'login_buckets',
      'sessions',
      'user_game_access',
      'role_permissions',
      'user_roles',
      'permissions',
      'roles',
      'users',
    ])
      await r.query(`DROP TABLE "${table}"`);
  }
}
