import { GenerationEventsService } from './generation-events.service';

describe('GenerationEventsService', () => {
  it('queries once and fans a complete job out to concurrent local subscribers', async () => {
    let onMessage: ((channel: string, jobId: string) => void) | undefined;
    const subscriber = {
      status: 'ready',
      on: jest.fn((event: string, listener: (...args: any[]) => void) => { if (event === 'message') onMessage = listener; }),
      connect: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockResolvedValue(1),
      unsubscribe: jest.fn().mockResolvedValue(0),
      quit: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
    };
    const redis = { client: { duplicate: jest.fn().mockReturnValue(subscriber), publish: jest.fn() } } as any;
    const prisma = { generationJob: { findFirst: jest.fn().mockResolvedValue({
      id: 'job-1', conversationId: 'conversation-1', status: 'SUCCEEDED', mode: 'TEXT_TO_IMAGE', prompt: 'done',
      errorMessage: null, parameters: { count: 1 }, modelSnapshot: { displayName: 'model' }, assets: [],
    }) } } as any;
    const service = new GenerationEventsService(redis, prisma);
    await service.onModuleInit();
    const first = jest.fn();
    const second = jest.fn();
    const [releaseFirst, releaseSecond] = await Promise.all([
      service.subscribe('user-1', first),
      service.subscribe('user-1', second),
    ]);

    onMessage?.('generation-events:v1:user-1', 'job-1');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(subscriber.subscribe).toHaveBeenCalledTimes(1);
    expect(prisma.generationJob.findFirst).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1', status: 'SUCCEEDED' }));
    expect(second).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1', status: 'SUCCEEDED' }));
    await releaseFirst();
    await releaseSecond();
    expect(subscriber.unsubscribe).toHaveBeenCalledTimes(1);
    await service.onModuleDestroy();
  });
});
