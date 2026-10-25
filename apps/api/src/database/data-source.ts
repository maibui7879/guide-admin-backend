import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { parseEnvironment } from '../config/env';
import { Foundation1792800000000 } from './migrations/1792800000000-foundation';
import { connectionOptions } from './connection-options';
import type { Environment } from '../config/env';
import { catalogEntities } from '../modules/catalog/entities/catalog.entities';
import { Catalog1792800001000 } from './migrations/1792800001000-catalog';
import { authEntities } from '../modules/auth/entities/auth.entities';
import { Identity1792800002000 } from './migrations/1792800002000-identity';
import { Publishing1792800003000 } from './migrations/1792800003000-publishing';
import { GuideCategories1792800004000 } from './migrations/1792800004000-guide-categories';
import { Teams1792800005000 } from './migrations/1792800005000-teams';
import { CharacterProgression1792800006000 } from './migrations/1792800006000-character-progression';
import { WikiIdentity1792800007000 } from './migrations/1792800007000-wiki-identity';
import { GuideMedia1792800008000 } from './migrations/1792800008000-guide-media';
import { MediaLibrary1792800009000 } from './migrations/1792800009000-media-library';
import { Strategy1792800010000 } from './migrations/1792800010000-strategy';
import { Search1792800011000 } from './migrations/1792800011000-search';
import { ReliableEvents1792800012000 } from './migrations/1792800012000-reliable-events';
import { ImportStaging1792800013000 } from './migrations/1792800013000-import-staging';
import { Operations1792800014000 } from './migrations/1792800014000-operations';
import { CharacterMedia1792800015000 } from './migrations/1792800015000-character-media';
import { mediaEntities } from '../modules/media/media.entities';
import { TeamEntity } from '../modules/teams/entities/team.entity';
import { contentEntities } from '../modules/guides/entities/content.entities';
import { AuditEntryEntity } from '../modules/audit/entities/audit-entry.entity';

export function createDataSource(
  env: Pick<Environment, 'DATABASE_URL' | 'DATABASE_SSL_INSECURE' | 'NODE_ENV'>,
): DataSource {
  return new DataSource({
    type: 'postgres',
    ...connectionOptions(env),
    synchronize: false,
    migrationsRun: false,
    entities: [
      ...catalogEntities,
      ...authEntities,
      ...contentEntities,
      ...mediaEntities,
      AuditEntryEntity,
      TeamEntity,
    ],
    migrations: [
      Foundation1792800000000,
      Catalog1792800001000,
      Identity1792800002000,
      Publishing1792800003000,
      GuideCategories1792800004000,
      Teams1792800005000,
      CharacterProgression1792800006000,
      WikiIdentity1792800007000,
      GuideMedia1792800008000,
      MediaLibrary1792800009000,
      Strategy1792800010000,
      Search1792800011000,
      ReliableEvents1792800012000,
      ImportStaging1792800013000,
      Operations1792800014000,
      CharacterMedia1792800015000,
    ],
    logging: false,
    extra: { connectionTimeoutMillis: 3000, statement_timeout: 5000 },
  });
}
export default createDataSource(parseEnvironment(process.env));
