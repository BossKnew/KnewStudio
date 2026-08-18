import { HttpException } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service';

describe('RateLimitService', () => {
  it('uses one Redis script for increment and expiry', async () => {
    const evalMock = jest.fn().mockResolvedValue([1, 600]);
    const service = new RateLimitService({ client: { eval: evalMock } } as any);
    await service.consume('login-ip', '127.0.0.1', 1, 600);
    expect(evalMock).toHaveBeenCalledTimes(1);
    expect(evalMock.mock.calls[0][1]).toBe(1);
    expect(evalMock.mock.calls[0][3]).toBe(600);
  });

  it('blocks a failure as soon as the configured threshold is reached', async () => {
    const service = new RateLimitService({ client: { eval: jest.fn().mockResolvedValue([3, 420]) } } as any);
    await expect(service.recordFailure('login-account-failure', 'alice', 3, 600)).rejects.toMatchObject({ status: 429 });
  });

  it('releases a concurrency lease only once', async () => {
    const evalMock = jest.fn().mockResolvedValueOnce([1, 600]).mockResolvedValueOnce(0);
    const service = new RateLimitService({ client: { eval: evalMock } } as any);
    const release = await service.acquireConcurrency('upload-active', 'user-1', 2, 600);
    await release();
    await release();
    expect(evalMock).toHaveBeenCalledTimes(2);
  });

  it('rejects an unavailable concurrency slot', async () => {
    const service = new RateLimitService({ client: { eval: jest.fn().mockResolvedValue([0, 300]) } } as any);
    await expect(service.acquireConcurrency('upload-active', 'user-1', 2, 600)).rejects.toBeInstanceOf(HttpException);
  });
});
