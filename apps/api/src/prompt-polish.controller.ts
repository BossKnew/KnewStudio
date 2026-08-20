import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from './common';
import { parseBody, safeText } from './validation';
import { PromptPolishService } from './prompt-polish.service';
import { RateLimitService } from './rate-limit.service';
import { securityConfig } from './security-config';

const adminConfigSchema = z.object({
  providerName: safeText(64),
  baseUrl: z.string().max(2048),
  apiKey: z.string().max(16_384).optional(),
  modelId: safeText(256),
  timeoutSeconds: z.number().int().min(10).max(600).optional(),
  enabled: z.boolean().optional(),
  systemPrompt: z.string().max(16_000).nullable().optional(),
}).strict();

const polishSchema = z.object({ prompt: safeText(8000), mode: z.literal('TEXT_TO_IMAGE') }).strict();

@Roles('ADMIN')
@Controller('admin/prompt-polish')
export class PromptPolishAdminController {
  constructor(private service: PromptPolishService) {}

  @Get()
  settings() { return this.service.adminSettings(); }

  @Patch()
  async save(@CurrentUser() actor: AuthUser, @Body() raw: unknown) {
    const body = parseBody(adminConfigSchema, raw);
    const result = await this.service.save(body);
    await this.service.audit(actor.id, 'prompt-polish.updated');
    return result;
  }

  @Post('test')
  async test(@CurrentUser() actor: AuthUser) {
    const result = await this.service.test();
    await this.service.audit(actor.id, 'prompt-polish.tested', { ok: result.ok });
    return result;
  }
}

@Controller('prompt-polish')
export class PromptPolishController {
  constructor(private service: PromptPolishService, private limits: RateLimitService) {}

  @Post()
  async polish(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    const body = parseBody(polishSchema, raw);
    await this.limits.consume('prompt-polish-user', user.id, securityConfig.generationLimit(), 600);
    return this.service.polish(body.prompt);
  }
}
