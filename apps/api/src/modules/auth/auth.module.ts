import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { CatalogModule } from '../catalog/catalog.module';
import { AuthController } from './controllers/auth.controller';
import { AuthGuard } from './guards/auth.guard';
import { AUTH_SETTINGS, AuthService, AuthSettings } from './services/auth.service';
import { UsersService } from './services/users.service';
import { AdminUsersController } from './controllers/admin-users.controller';

@Module({})
export class AuthModule {
  static register(db: DataSource, settings?: AuthSettings): DynamicModule {
    return {
      module: AuthModule,
      imports: [CatalogModule.register(db)],
      controllers: [AuthController, AdminUsersController],
      providers: [
        { provide: DataSource, useValue: db },
        { provide: AUTH_SETTINGS, useValue: settings ?? null },
        AuthService,
        UsersService,
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}
