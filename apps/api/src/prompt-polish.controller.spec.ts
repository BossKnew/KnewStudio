import { BadRequestException } from '@nestjs/common';
import { PromptPolishController } from './prompt-polish.controller';

describe('PromptPolishController', () => {
  it('rate limits and forwards only text-to-image prompts', async () => {
    const service = { polish: jest.fn().mockResolvedValue({ polishedPrompt: 'polished' }) };
    const limits = { consume: jest.fn().mockResolvedValue(undefined) };
    const controller = new PromptPolishController(service as any, limits as any);

    await expect(controller.polish({ id: 'user-1' } as any, { prompt: 'a cat', mode: 'TEXT_TO_IMAGE' })).resolves.toEqual({ polishedPrompt: 'polished' });
    expect(limits.consume).toHaveBeenCalledWith('prompt-polish-user', 'user-1', expect.any(Number), 600);
    expect(service.polish).toHaveBeenCalledWith('a cat');
  });

  it('rejects editing modes before calling the LLM service', async () => {
    const service = { polish: jest.fn() };
    const limits = { consume: jest.fn() };
    const controller = new PromptPolishController(service as any, limits as any);

    await expect(controller.polish({ id: 'user-1' } as any, { prompt: 'edit this', mode: 'IMAGE_EDIT' })).rejects.toBeInstanceOf(BadRequestException);
    expect(service.polish).not.toHaveBeenCalled();
    expect(limits.consume).not.toHaveBeenCalled();
  });
});
