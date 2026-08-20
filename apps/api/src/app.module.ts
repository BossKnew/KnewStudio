import './load-secret-files';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { AdminController } from './admin.controller';
import { AssetsController } from './assets.controller';
import { AuthController } from './auth.controller';
import { SessionGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { ConversationsController } from './conversations.controller';
import { CryptoService } from './crypto.service';
import { GenerationsController } from './generations.controller';
import { HealthController } from './health.controller';
import { ModelsController } from './models.controller';
import { PrismaService } from './prisma.service';
import { ProvidersController } from './providers.controller';
import { RedisService } from './redis.service';
import { StorageService } from './storage.service';
import { SafeHttpService } from './safe-http.service';
import { RateLimitService } from './rate-limit.service';
import { QuotaService } from './quota.service';
import { MfaCryptoService } from './mfa-crypto.service';
import { MfaService } from './mfa.service';
import { GenerationProcessor } from './generation.processor';
import { parseRedisUrl } from './redis-config';
import { UploadAdmissionInterceptor } from './upload-admission.interceptor';
import { AuthContextService } from './auth-context.service';
import { GenerationEventsService } from './generation-events.service';
import { GenerationLifecycleService } from './generation-lifecycle.service';
import { AssetLifecycleService } from './asset-lifecycle.service';
import { PromptsController } from './prompts.controller';
import { PromptPolishAdminController, PromptPolishController } from './prompt-polish.controller';
import { PromptPolishService } from './prompt-polish.service';

const sharedProviders = [PrismaService, RedisService, RateLimitService, QuotaService, CryptoService, MfaCryptoService, MfaService, StorageService, AssetLifecycleService, SafeHttpService, AuthContextService, GenerationEventsService, GenerationLifecycleService, AuthService, PromptPolishService];

@Module({
  imports: [BullModule.forRoot({ connection: parseRedisUrl() }), BullModule.registerQueue({ name: 'image-generation' })],
  controllers: [HealthController, AuthController, AdminController, ProvidersController, ModelsController, AssetsController, ConversationsController, GenerationsController, PromptsController, PromptPolishAdminController, PromptPolishController],
  providers: [...sharedProviders, GenerationProcessor, UploadAdmissionInterceptor, { provide: APP_GUARD, useClass: SessionGuard }],
})
export class AppModule {}
