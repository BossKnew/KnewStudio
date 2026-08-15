import { lastValueFrom, of, throwError } from 'rxjs';
import { UploadAdmissionInterceptor } from './upload-admission.interceptor';

describe('UploadAdmissionInterceptor', () => {
  const context = {
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'user-1' } }) }),
  } as any;

  it('admits the request before the file interceptor and releases on success', async () => {
    const release = jest.fn().mockResolvedValue(undefined);
    const limits = { consume: jest.fn(), acquireConcurrency: jest.fn().mockResolvedValue(release) };
    const interceptor = new UploadAdmissionInterceptor(limits as any);
    const observable = await interceptor.intercept(context, { handle: jest.fn(() => of('ok')) });
    await expect(lastValueFrom(observable)).resolves.toBe('ok');
    expect(limits.consume).toHaveBeenCalledWith('upload-user', 'user-1', 30, 600);
    expect(limits.acquireConcurrency).toHaveBeenCalledWith('upload-active', 'user-1', 2, 600);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases the slot when downstream parsing fails', async () => {
    const release = jest.fn().mockResolvedValue(undefined);
    const interceptor = new UploadAdmissionInterceptor({ consume: jest.fn(), acquireConcurrency: jest.fn().mockResolvedValue(release) } as any);
    const observable = await interceptor.intercept(context, { handle: () => throwError(() => new Error('invalid upload')) });
    await expect(lastValueFrom(observable)).rejects.toThrow('invalid upload');
    expect(release).toHaveBeenCalledTimes(1);
  });
});
