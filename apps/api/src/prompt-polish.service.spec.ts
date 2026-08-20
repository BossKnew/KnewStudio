import { HttpException } from '@nestjs/common';
import { DEFAULT_PROMPT_POLISH_SYSTEM_PROMPT } from './prompt-polish.constants';
import { PromptPolishService } from './prompt-polish.service';

describe('PromptPolishService', () => {
  let prisma: any;
  let crypto: any;
  let http: any;
  let service: PromptPolishService;

  const setting = {
    id: 'default',
    providerName: 'LLM',
    baseUrl: 'https://llm.example.com/v1',
    encryptedApiKey: 'encrypted-key',
    modelId: 'polisher',
    timeoutSeconds: 60,
    enabled: true,
    systemPrompt: null,
    testCooldownUntil: null,
    lastTestOk: null,
  };

  beforeEach(() => {
    prisma = {
      promptPolishSetting: {
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue(setting),
        updateMany: jest.fn(),
        update: jest.fn().mockResolvedValue(setting),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    crypto = {
      encrypt: jest.fn((value: string) => `encrypted:${value}`),
      decrypt: jest.fn(() => 'secret-key'),
    };
    http = {
      validateBaseUrl: jest.fn((value: string) => value.replace(/\/$/, '')),
      request: jest.fn(),
    };
    service = new PromptPolishService(prisma, crypto, http);
  });

  it('returns an unconfigured masked admin shape without exposing a secret', async () => {
    prisma.promptPolishSetting.findUnique.mockResolvedValue(null);

    await expect(service.adminSettings()).resolves.toEqual(expect.objectContaining({
      configured: false,
      enabled: false,
      usingDefaultSystemPrompt: true,
      apiKeyMasked: '',
      hasApiKey: false,
    }));
  });

  it('saves a custom system prompt and encrypts a supplied API key', async () => {
    prisma.promptPolishSetting.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...setting, systemPrompt: ' custom instructions ' });

    const result = await service.save({
      providerName: '  LLM  ',
      baseUrl: 'https://llm.example.com/v1/',
      apiKey: 'new-secret',
      modelId: 'polisher',
      systemPrompt: ' custom instructions ',
    });

    expect(crypto.encrypt).toHaveBeenCalledWith('new-secret');
    expect(prisma.promptPolishSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'default' },
      create: expect.objectContaining({
        providerName: 'LLM',
        baseUrl: 'https://llm.example.com/v1',
        encryptedApiKey: 'encrypted:new-secret',
        systemPrompt: 'custom instructions',
      }),
    }));
    expect(result.systemPrompt).toBe(' custom instructions ');
  });

  it('keeps the existing encrypted key when an edit leaves API Key blank', async () => {
    prisma.promptPolishSetting.findUnique.mockResolvedValueOnce(setting).mockResolvedValueOnce(setting);

    await service.save({ providerName: 'LLM', baseUrl: setting.baseUrl, modelId: setting.modelId, apiKey: '' });

    expect(crypto.encrypt).not.toHaveBeenCalled();
    expect(prisma.promptPolishSetting).toHaveProperty('upsert');
    expect(prisma.promptPolishSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ encryptedApiKey: 'encrypted-key' }),
    }));
  });

  it('preserves a custom system prompt when a partial update omits that field', async () => {
    const custom = { ...setting, systemPrompt: 'keep this instruction' };
    prisma.promptPolishSetting.findUnique.mockResolvedValueOnce(custom).mockResolvedValueOnce(custom);

    await service.save({ providerName: 'LLM', baseUrl: setting.baseUrl, modelId: setting.modelId });

    expect(prisma.promptPolishSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ systemPrompt: 'keep this instruction' }),
    }));
  });

  it('uses a custom system prompt in the OpenAI-compatible request', async () => {
    const custom = { ...setting, systemPrompt: 'Only return a polished prompt.' };
    prisma.promptPolishSetting.findUnique.mockResolvedValue(custom);
    http.request.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: Buffer.from(JSON.stringify({ choices: [{ message: { content: 'polished prompt' } }] })),
    });

    await expect(service.polish('原始提示词')).resolves.toEqual({ polishedPrompt: 'polished prompt' });
    const [url, init] = http.request.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(url).toBe('https://llm.example.com/v1/chat/completions');
    expect(body.model).toBe('polisher');
    expect(body.messages).toEqual([
      { role: 'system', content: 'Only return a polished prompt.' },
      { role: 'user', content: '原始提示词' },
    ]);
    expect(init.headers.Authorization).toBe('Bearer secret-key');
  });

  it('falls back to the built-in system prompt when the saved value is blank', async () => {
    prisma.promptPolishSetting.findUnique.mockResolvedValue({ ...setting, systemPrompt: '   ' });
    http.request.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: Buffer.from(JSON.stringify({ choices: [{ message: { content: 'polished prompt' } }] })),
    });

    await service.polish('原始提示词');

    const body = JSON.parse(http.request.mock.calls[0][1].body);
    expect(body.messages[0]).toEqual({ role: 'system', content: DEFAULT_PROMPT_POLISH_SYSTEM_PROMPT });
  });

  it('rejects an empty or oversized provider response', async () => {
    prisma.promptPolishSetting.findUnique.mockResolvedValue(setting);
    http.request.mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), body: Buffer.from('{"choices":[{"message":{"content":""}}]}') });
    await expect(service.polish('原始提示词')).rejects.toThrow('供应商未返回有效的润色提示词');

    http.request.mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), body: Buffer.from(JSON.stringify({ choices: [{ message: { content: 'x'.repeat(8001) } }] })) });
    await expect(service.polish('原始提示词')).rejects.toThrow('供应商返回的润色提示词超过 8000 个字符');
  });

  it('persists a successful test result and enforces the test cooldown', async () => {
    prisma.promptPolishSetting.updateMany.mockResolvedValue({ count: 1 });
    prisma.promptPolishSetting.findUnique.mockResolvedValue(setting);
    http.request.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: Buffer.from(JSON.stringify({ choices: [{ message: { content: '测试结果' } }] })),
    });

    const result = await service.test();

    expect(result).toMatchObject({ ok: true, cooldownUntil: expect.any(Date) });
    expect(prisma.promptPolishSetting.update).toHaveBeenCalledWith({ where: { id: 'default' }, data: { lastTestOk: true } });

    prisma.promptPolishSetting.updateMany.mockResolvedValue({ count: 0 });
    prisma.promptPolishSetting.findUnique.mockResolvedValue({ testCooldownUntil: new Date(Date.now() + 90_000) });
    await expect(service.test()).rejects.toBeInstanceOf(HttpException);
  });
});
