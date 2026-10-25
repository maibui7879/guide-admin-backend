import { DynamicModule, Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AdminTeamsController } from './controllers/admin-teams.controller';
import { TeamsController } from './controllers/teams.controller';
import { TeamsService } from './services/teams.service';

@Module({})
export class TeamsModule {
  static register(db: DataSource): DynamicModule {
    return {
      module: TeamsModule,
      controllers: [TeamsController, AdminTeamsController],
      providers: [{ provide: DataSource, useValue: db }, TeamsService],
    };
  }
}
