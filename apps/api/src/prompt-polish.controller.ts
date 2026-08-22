import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from './common';
import { parseBody, safeText, uuidSchema } from './validation';
import { PromptPolishService } from './prompt-polish.service';
import { RateLimitService } from './rate-limit.service';
import { securityConfig } from './security-config';

const adminConfigSchema = z.object({
  name: safeText(64),
  providerName: safeText(64),
  baseUrl: z.string().max(2048),
  apiKey: z.string().max(16_384).optional(),
  modelId: safeText(256),
  timeoutSeconds: z.number().int().min(10).max(600).optional(),
  enabled: z.boolean().optional(),
  systemPrompt: z.string().max(16_000).nullable().optional(),
  supportsImageEdit: z.boolean().optional(),
}).strict();

const polishSchema = z.object({ prompt: safeText(8000), mode: z.enum(['TEXT_TO_IMAGE', 'IMAGE_EDIT', 'TEXT_TO_VIDEO']), sourceAssetId: uuidSchema.optional() }).strict();

@Roles('ADMIN')
@Controller('admin/prompt-polish')
export class PromptPolishAdminController {
  constructor(private service: PromptPolishService) {}

  @Get()
  settings() { return this.service.list(); }

  @Post()
  async create(@CurrentUser() actor: AuthUser, @Body() raw: unknown) {
    const body = parseBody(adminConfigSchema, raw);
    const result = await this.service.save(body);
    await this.service.audit(actor.id, 'prompt-polish.created', result.id);
    return result;
  }

  @Patch(':id')
  async update(@CurrentUser() actor: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() raw: unknown) {
    const body = parseBody(adminConfigSchema, raw);
    const result = await this.service.save(body, id);
    await this.service.audit(actor.id, 'prompt-polish.updated', id);
    return result;
  }

  @Delete(':id')
  async remove(@CurrentUser() actor: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    await this.service.remove(id);
    await this.service.audit(actor.id, 'prompt-polish.deleted', id);
    return { ok: true };
  }

  @Post(':id/test')
  async test(@CurrentUser() actor: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const result = await this.service.test(id);
    await this.service.audit(actor.id, 'prompt-polish.tested', id, { ok: result.ok });
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
    return this.service.polish(user, body.prompt, body.mode, body.sourceAssetId);
  }
}
