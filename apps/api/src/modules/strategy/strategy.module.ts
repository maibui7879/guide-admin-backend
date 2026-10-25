import { DynamicModule, Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ContentAccessService } from '../guides/services/content-access.service';
import { EquipmentController, AdminEquipmentController } from './controllers/equipment.controller';
import { strategyControllers } from './controllers/strategy.controllers';
import { EquipmentService } from './services/equipment.service';
import { StrategyService } from './services/strategy.service';
const controllers = [
  EquipmentController,
  AdminEquipmentController,
  ...strategyControllers('build', 'builds'),
  ...strategyControllers('tier_list', 'tier-lists'),
];
@Module({})
export class StrategyModule {
  static register(db: DataSource): DynamicModule {
    return {
      module: StrategyModule,
      controllers,
      providers: [
        { provide: DataSource, useValue: db },
        ContentAccessService,
        EquipmentService,
        StrategyService,
      ],
    };
  }
}
