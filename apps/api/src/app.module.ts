import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthModule } from './modules/auth/auth.module';
import { GuidesModule } from './modules/guides/guides.module';
import { TeamsModule } from './modules/teams/teams.module';
import { StrategyModule } from './modules/strategy/strategy.module';
import { SearchModule } from './modules/search/search.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { ImportsModule } from './modules/imports/imports.module';
import { OperationsModule } from './modules/operations/operations.module';
import type { AuthSettings } from './modules/auth/services/auth.service';
import { HealthController } from './modules/health/health.controller';
import { DatabaseShutdown } from './database/database-shutdown.service';
@Module({})
export class AppModule {
  static register(db: DataSource, settings?: AuthSettings) {
    return {
      module: AppModule,
      imports: [
        AuthModule.register(db, settings),
        GuidesModule.register(db),
        TeamsModule.register(db),
        StrategyModule.register(db),
        SearchModule.register(db),
        JobsModule.register(db),
        ImportsModule.register(db),
        OperationsModule.register(db),
      ],
      controllers: [HealthController],
      providers: [{ provide: DataSource, useValue: db }, DatabaseShutdown],
    };
  }
}
