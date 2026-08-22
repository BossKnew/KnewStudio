import { BadRequestException } from '@nestjs/common';
import { PromptPolishAdminController, PromptPolishController } from './prompt-polish.controller';
import type { PromptPolishService } from './prompt-polish.service';
import type { RateLimitService } from './rate-limit.service';
import type { AuthUser } from './common';

const user: AuthUser = { id: 'user-1', username: 'u', displayName: null, role: 'USER', status: 'ACTIVE', mustChangePwd: false, mfaEnabled: false, mfaRequired: false, groupIds: [] };
const admin: AuthUser = { ...user, role: 'ADMIN' };
const CONFIG_ID = '11111111-1111-4111-8111-111111111111';

const configBody = {
  name: '主供应商',
  providerName: 'LLM',
  baseUrl: 'https://llm.example.com/v1',
  apiKey: 'secret',
  modelId: 'polisher',
  timeoutSeconds: 60,
  enabled: true,
  systemPrompt: '',
  supportsImageEdit: false,
};

describe('PromptPolishAdminController', () => {
  it('lists prompt polishing configs', async () => {
    const service = { list: jest.fn().mockResolvedValue({ items: [] }), audit: jest.fn() };
    const controller = new PromptPolishAdminController(service as unknown as PromptPolishService);

    await expect(controller.settings()).resolves.toEqual({ items: [] });
    expect(service.list).toHaveBeenCalled();
  });

  it('creates a config and audits the action', async () => {
    const service = { save: jest.fn().mockResolvedValue({ id: CONFIG_ID }), audit: jest.fn() };
    const controller = new PromptPolishAdminController(service as unknown as PromptPolishService);

    const result = await controller.create(admin, configBody);

    expect(service.save).toHaveBeenCalledWith(expect.objectContaining({ name: '主供应商' }));
    expect(service.audit).toHaveBeenCalledWith('user-1', 'prompt-polish.created', CONFIG_ID);
    expect(result).toEqual({ id: CONFIG_ID });
  });

  it('updates a config by id and audits the action', async () => {
    const service = { save: jest.fn().mockResolvedValue({ id: CONFIG_ID }), audit: jest.fn() };
    const controller = new PromptPolishAdminController(service as unknown as PromptPolishService);

    const result = await controller.update(admin, CONFIG_ID, { ...configBody, enabled: false });

    expect(service.save).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }), CONFIG_ID);
    expect(service.audit).toHaveBeenCalledWith('user-1', 'prompt-polish.updated', CONFIG_ID);
    expect(result).toEqual({ id: CONFIG_ID });
  });

  it('removes a config by id and audits the action', async () => {
    const service = { remove: jest.fn().mockResolvedValue({ ok: true }), audit: jest.fn() };
    const controller = new PromptPolishAdminController(service as unknown as PromptPolishService);

    await expect(controller.remove(admin, CONFIG_ID)).resolves.toEqual({ ok: true });
    expect(service.remove).toHaveBeenCalledWith(CONFIG_ID);
    expect(service.audit).toHaveBeenCalledWith('user-1', 'prompt-polish.deleted', CONFIG_ID);
  });

  it('tests a config by id and audits the outcome', async () => {
    const service = { test: jest.fn().mockResolvedValue({ ok: true, cooldownUntil: 'x' }), audit: jest.fn() };
    const controller = new PromptPolishAdminController(service as unknown as PromptPolishService);

    const result = await controller.test(admin, CONFIG_ID);

    expect(service.test).toHaveBeenCalledWith(CONFIG_ID);
    expect(service.audit).toHaveBeenCalledWith('user-1', 'prompt-polish.tested', CONFIG_ID, { ok: true });
    expect(result).toEqual({ ok: true, cooldownUntil: 'x' });
  });
});

describe('PromptPolishController', () => {
  it('rate limits and forwards text-to-image prompts to the service', async () => {
    const service = { polish: jest.fn().mockResolvedValue({ polishedPrompt: 'polished' }) };
    const limits = { consume: jest.fn().mockResolvedValue(undefined) };
    const controller = new PromptPolishController(service as unknown as PromptPolishService, limits as unknown as RateLimitService);

    await expect(controller.polish(user, { prompt: 'a cat', mode: 'TEXT_TO_IMAGE' })).resolves.toEqual({ polishedPrompt: 'polished' });
    expect(limits.consume).toHaveBeenCalledWith('prompt-polish-user', 'user-1', expect.any(Number), 600);
    expect(service.polish).toHaveBeenCalledWith(user, 'a cat', 'TEXT_TO_IMAGE', undefined);
  });

  it('forwards image-edit prompts with the source asset id', async () => {
    const service = { polish: jest.fn().mockResolvedValue({ polishedPrompt: 'polished' }) };
    const limits = { consume: jest.fn().mockResolvedValue(undefined) };
    const controller = new PromptPolishController(service as unknown as PromptPolishService, limits as unknown as RateLimitService);

    await expect(controller.polish(user, { prompt: 'edit this', mode: 'IMAGE_EDIT', sourceAssetId: CONFIG_ID })).resolves.toEqual({ polishedPrompt: 'polished' });
    expect(limits.consume).toHaveBeenCalledWith('prompt-polish-user', 'user-1', expect.any(Number), 600);
    expect(service.polish).toHaveBeenCalledWith(user, 'edit this', 'IMAGE_EDIT', CONFIG_ID);
  });

  it('rejects unsupported modes before calling the service', async () => {
    const service = { polish: jest.fn() };
    const limits = { consume: jest.fn() };
    const controller = new PromptPolishController(service as unknown as PromptPolishService, limits as unknown as RateLimitService);

    await expect(controller.polish(user, { prompt: 'repaint', mode: 'INPAINT' })).rejects.toBeInstanceOf(BadRequestException);
    expect(service.polish).not.toHaveBeenCalled();
    expect(limits.consume).not.toHaveBeenCalled();
  });
});
