import { HttpException } from '@nestjs/common';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PROMPT_POLISH_IMAGE_EDIT_SYSTEM_PROMPT, DEFAULT_PROMPT_POLISH_SYSTEM_PROMPT } from './prompt-polish.constants';
import { PromptPolishService } from './prompt-polish.service';
import type { CryptoService } from './crypto.service';
import type { PrismaService } from './prisma.service';
import type { SafeHttpService } from './safe-http.service';
import type { StorageService } from './storage.service';
import type { AuthUser } from './common';

const user: AuthUser = { id: 'user-1', username: 'u', displayName: null, role: 'USER', status: 'ACTIVE', mustChangePwd: false, mfaEnabled: false, mfaRequired: false, groupIds: [] };

type PromptPolishSettingMock = {
  promptPolishSetting: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    deleteMany: jest.Mock;
  };
  asset: { findFirst: jest.Mock };
  auditLog: { create: jest.Mock };
  $transaction: jest.Mock;
};

describe('PromptPolishService', () => {
  let prisma: PromptPolishSettingMock;
  let crypto: { encrypt: jest.Mock; decrypt: jest.Mock };
  let http: { validateBaseUrl: jest.Mock; request: jest.Mock };
  let storage: { filePath: jest.Mock };
  let service: PromptPolishService;

  const setting = {
    id: 'config-1',
    name: '主供应商',
    providerName: 'LLM',
    baseUrl: 'https://llm.example.com/v1',
    encryptedApiKey: 'encrypted-key',
    modelId: 'polisher',
    timeoutSeconds: 60,
    enabled: true,
    systemPrompt: null,
    supportsImageEdit: false,
    testCooldownUntil: null,
    lastTestOk: null,
  };

  beforeEach(() => {
    prisma = {
      promptPolishSetting: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      asset: { findFirst: jest.fn() },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((callback: (tx: PromptPolishSettingMock) => unknown) => callback(prisma)),
    };
    crypto = {
      encrypt: jest.fn((value: string) => `encrypted:${value}`),
      decrypt: jest.fn(() => 'secret-key'),
    };
    http = {
      validateBaseUrl: jest.fn((value: string) => value.replace(/\/$/, '')),
      request: jest.fn(),
    };
    storage = { filePath: jest.fn((key: string) => 'stored/' + key) };
    service = new PromptPolishService(prisma as unknown as PrismaService, crypto as unknown as CryptoService, http as unknown as SafeHttpService, storage as unknown as StorageService);
  });

  it('lists configs with masked admin shapes', async () => {
    prisma.promptPolishSetting.findMany.mockResolvedValue([{ ...setting, systemPrompt: ' custom ' }]);

    const result = await service.list();

    expect(prisma.promptPolishSetting.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'asc' } });
    expect(result.items).toEqual([expect.objectContaining({
      id: 'config-1',
      name: '主供应商',
      providerName: 'LLM',
      modelId: 'polisher',
      enabled: true,
      supportsImageEdit: false,
      usingDefaultSystemPrompt: false,
      hasApiKey: true,
    })]);
  });

  it('creates an enabled config and disables every other config in the same transaction', async () => {
    prisma.promptPolishSetting.create.mockResolvedValue({ ...setting, id: 'new-id', name: '备选', enabled: true, supportsImageEdit: true });

    const result = await service.save({ name: '备选', providerName: 'LLM', baseUrl: 'https://llm.example.com/v1/', apiKey: 'new-secret', modelId: 'polisher', enabled: true, supportsImageEdit: true });

    expect(crypto.encrypt).toHaveBeenCalledWith('new-secret');
    expect(prisma.promptPolishSetting.updateMany).toHaveBeenCalledWith({ where: { enabled: true }, data: { enabled: false } });
    expect(prisma.promptPolishSetting.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: '备选', baseUrl: 'https://llm.example.com/v1', encryptedApiKey: 'encrypted:new-secret', enabled: true, supportsImageEdit: true }),
    }));
    expect(result).toEqual(expect.objectContaining({ id: 'new-id', name: '备选', enabled: true, supportsImageEdit: true }));
  });

  it('creates a disabled config without touching other configs', async () => {
    prisma.promptPolishSetting.create.mockResolvedValue({ ...setting, id: 'new-id', enabled: false });

    await service.save({ name: '备选', providerName: 'LLM', baseUrl: setting.baseUrl, apiKey: 'new-secret', modelId: 'polisher', enabled: false });

    expect(prisma.promptPolishSetting.updateMany).not.toHaveBeenCalled();
    expect(prisma.promptPolishSetting.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ enabled: false }),
    }));
  });

  it('requires a name and an api key when creating', async () => {
    await expect(service.save({ name: '  ', providerName: 'LLM', baseUrl: setting.baseUrl, apiKey: 'new-secret', modelId: 'polisher' })).rejects.toThrow('供应商名称必填');
    await expect(service.save({ name: '主供应商', providerName: 'LLM', baseUrl: setting.baseUrl, modelId: 'polisher' })).rejects.toThrow('提示词润色 API Key 必填');
    expect(prisma.promptPolishSetting.create).not.toHaveBeenCalled();
  });

  it('updates a config and keeps the existing encrypted key when the key is left blank', async () => {
    prisma.promptPolishSetting.findUnique.mockResolvedValue(setting);
    prisma.promptPolishSetting.update.mockResolvedValue({ ...setting, name: '改名', systemPrompt: 'new instructions' });

    const result = await service.save({ name: '改名', providerName: 'LLM', baseUrl: setting.baseUrl, modelId: 'polisher', systemPrompt: 'new instructions' }, 'config-1');

    expect(crypto.encrypt).not.toHaveBeenCalled();
    expect(prisma.promptPolishSetting.updateMany).not.toHaveBeenCalled();
    expect(prisma.promptPolishSetting.update).toHaveBeenCalledWith({
      where: { id: 'config-1' },
      data: expect.objectContaining({ name: '改名', encryptedApiKey: 'encrypted-key', systemPrompt: 'new instructions', testCooldownUntil: null, lastTestOk: null }),
    });
    expect(result).toEqual(expect.objectContaining({ id: 'config-1', name: '改名', systemPrompt: 'new instructions' }));
  });

  it('disables other configs when an update enables the target', async () => {
    prisma.promptPolishSetting.findUnique.mockResolvedValue({ ...setting, enabled: false });
    prisma.promptPolishSetting.update.mockResolvedValue({ ...setting, enabled: true });

    await service.save({ name: '主供应商', providerName: 'LLM', baseUrl: setting.baseUrl, modelId: 'polisher', enabled: true }, 'config-1');

    expect(prisma.promptPolishSetting.updateMany).toHaveBeenCalledWith({ where: { id: { not: 'config-1' }, enabled: true }, data: { enabled: false } });
    expect(prisma.promptPolishSetting.update).toHaveBeenCalledWith({ where: { id: 'config-1' }, data: expect.objectContaining({ enabled: true }) });
  });

  it('rejects updates and removals for unknown configs', async () => {
    prisma.promptPolishSetting.findUnique.mockResolvedValue(null);
    await expect(service.save({ name: '主供应商', providerName: 'LLM', baseUrl: setting.baseUrl, apiKey: 'x', modelId: 'polisher' }, 'missing')).rejects.toThrow('配置不存在');

    prisma.promptPolishSetting.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.remove('missing')).rejects.toThrow('配置不存在');
    expect(prisma.promptPolishSetting.deleteMany).toHaveBeenCalledWith({ where: { id: 'missing' } });
  });

  it('removes a config', async () => {
    prisma.promptPolishSetting.deleteMany.mockResolvedValue({ count: 1 });

    await expect(service.remove('config-1')).resolves.toEqual({ ok: true });
  });

  it('uses the enabled config for polishing', async () => {
    prisma.promptPolishSetting.findFirst.mockResolvedValue(setting);
    http.request.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: Buffer.from(JSON.stringify({ choices: [{ message: { content: 'polished prompt' } }] })),
    });

    await expect(service.polish(user, '原始提示词')).resolves.toEqual({ polishedPrompt: 'polished prompt' });
    expect(prisma.promptPolishSetting.findFirst).toHaveBeenCalledWith({ where: { enabled: true } });
    const [url, init] = http.request.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(url).toBe('https://llm.example.com/v1/chat/completions');
    expect(body.messages).toEqual([
      { role: 'system', content: DEFAULT_PROMPT_POLISH_SYSTEM_PROMPT },
      { role: 'user', content: '原始提示词' },
    ]);
    expect(init.headers.Authorization).toBe('Bearer secret-key');
  });

  it('rejects polishing when no config is enabled', async () => {
    prisma.promptPolishSetting.findFirst.mockResolvedValue(null);

    await expect(service.polish(user, '原始提示词')).rejects.toThrow('提示词润色未启用');
    expect(http.request).not.toHaveBeenCalled();
  });

  it('rejects image-edit polishing when the enabled config does not support it', async () => {
    prisma.promptPolishSetting.findFirst.mockResolvedValue(setting);

    await expect(service.polish(user, 'edit', 'IMAGE_EDIT', 'asset-1')).rejects.toThrow('该模型未启用图片编辑提示词润色，请联系管理员');
    expect(http.request).not.toHaveBeenCalled();
  });

  it('requires a reference image for image-edit polishing', async () => {
    prisma.promptPolishSetting.findFirst.mockResolvedValue({ ...setting, supportsImageEdit: true });

    await expect(service.polish(user, 'edit', 'IMAGE_EDIT')).rejects.toThrow('图片编辑提示词润色需要参考图');
    expect(http.request).not.toHaveBeenCalled();
  });

  it('rejects an unknown reference image', async () => {
    prisma.promptPolishSetting.findFirst.mockResolvedValue({ ...setting, supportsImageEdit: true });
    prisma.asset.findFirst.mockResolvedValue(null);

    await expect(service.polish(user, 'edit', 'IMAGE_EDIT', 'asset-1')).rejects.toThrow('引用图片不存在');
    expect(http.request).not.toHaveBeenCalled();
  });

  it('sends the reference image with the image-edit system prompt', async () => {
    const originalCwd = process.cwd();
    process.chdir(tmpdir());
    const refDir = join('stored', 'user-1');
    const refPath = join(refDir, 'ref.png');
    try {
      await mkdir(refDir, { recursive: true });
      await writeFile(refPath, Buffer.from('fake-image'));

      prisma.promptPolishSetting.findFirst.mockResolvedValue({ ...setting, supportsImageEdit: true });
      prisma.asset.findFirst.mockResolvedValue({ objectKey: 'user-1/ref.png', mimeType: 'image/png' });
      http.request.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        body: Buffer.from(JSON.stringify({ choices: [{ message: { content: 'polished edit' } }] })),
      });

      await expect(service.polish(user, 'edit', 'IMAGE_EDIT', 'asset-1')).resolves.toEqual({ polishedPrompt: 'polished edit' });

      expect(prisma.asset.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'asset-1' }) }));
      const [url, init] = http.request.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(url).toBe('https://llm.example.com/v1/chat/completions');
      expect(body.messages).toEqual([
        { role: 'system', content: DEFAULT_PROMPT_POLISH_IMAGE_EDIT_SYSTEM_PROMPT },
        { role: 'user', content: [{ type: 'text', text: 'edit' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,ZmFrZS1pbWFnZQ==' } }] },
      ]);
    } finally {
      await rm(join('stored'), { recursive: true, force: true });
      process.chdir(originalCwd);
    }
  });

  it('rejects a source asset passed to non-image-edit modes', async () => {
    prisma.promptPolishSetting.findFirst.mockResolvedValue(setting);

    await expect(service.polish(user, 'v', 'TEXT_TO_VIDEO', 'asset-1')).rejects.toThrow('参考图仅用于图片编辑提示词润色');
    expect(http.request).not.toHaveBeenCalled();
  });

  it('rejects an empty or oversized provider response', async () => {
    prisma.promptPolishSetting.findFirst.mockResolvedValue(setting);
    http.request.mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), body: Buffer.from('{"choices":[{"message":{"content":""}}]}') });
    await expect(service.polish(user, '原始提示词')).rejects.toThrow('供应商未返回有效的润色提示词');

    http.request.mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), body: Buffer.from(JSON.stringify({ choices: [{ message: { content: 'x'.repeat(8001) } }] })) });
    await expect(service.polish(user, '原始提示词')).rejects.toThrow('供应商返回的润色提示词超过 8000 个字符');
  });

  it('tests a config and persists the outcome', async () => {
    prisma.promptPolishSetting.updateMany.mockResolvedValue({ count: 1 });
    prisma.promptPolishSetting.findUnique.mockResolvedValue(setting);
    http.request.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: Buffer.from(JSON.stringify({ choices: [{ message: { content: '测试结果' } }] })),
    });

    const result = await service.test('config-1');

    expect(prisma.promptPolishSetting.updateMany).toHaveBeenCalledWith({
      where: { id: 'config-1', OR: [{ testCooldownUntil: null }, { testCooldownUntil: { lte: expect.any(Date) } }] },
      data: expect.objectContaining({ lastTestOk: null }),
    });
    expect(result).toMatchObject({ ok: true, cooldownUntil: expect.any(Date) });
    expect(prisma.promptPolishSetting.update).toHaveBeenCalledWith({ where: { id: 'config-1' }, data: { lastTestOk: true } });
  });

  it('enforces the test cooldown and rejects unknown configs', async () => {
    prisma.promptPolishSetting.updateMany.mockResolvedValue({ count: 0 });
    prisma.promptPolishSetting.findUnique.mockResolvedValue({ testCooldownUntil: new Date(Date.now() + 90_000) });
    await expect(service.test('config-1')).rejects.toBeInstanceOf(HttpException);

    prisma.promptPolishSetting.findUnique.mockResolvedValue(null);
    await expect(service.test('missing')).rejects.toThrow('配置不存在');
  });
});
