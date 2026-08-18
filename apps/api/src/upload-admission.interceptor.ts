import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor, UnauthorizedException } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthUser } from './common';
import { RateLimitService } from './rate-limit.service';
import { securityConfig } from './security-config';

@Injectable()
export class UploadAdmissionInterceptor implements NestInterceptor {
  private readonly logger = new Logger(UploadAdmissionInterceptor.name);

  constructor(private readonly limits: RateLimitService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!request.user) throw new UnauthorizedException();

    await this.limits.consume('upload-user', request.user.id, securityConfig.uploadLimit(), 600);
    const releaseLease = await this.limits.acquireConcurrency(
      'upload-active',
      request.user.id,
      securityConfig.maxConcurrentUploadsPerUser(),
      600,
    );
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      await releaseLease();
    };

    let source: Observable<unknown>;
    try {
      source = next.handle();
    } catch (error) {
      await release();
      throw error;
    }

    return new Observable((subscriber) => {
      const releaseAnd = (done: () => void) => {
        void release().catch((error) => this.logger.error('Failed to release upload admission slot', error)).finally(done);
      };
      const subscription = source.subscribe({
        next: (value) => subscriber.next(value),
        error: (error) => releaseAnd(() => subscriber.error(error)),
        complete: () => releaseAnd(() => subscriber.complete()),
      });
      return () => {
        subscription.unsubscribe();
        void release().catch((error) => this.logger.error('Failed to release cancelled upload admission slot', error));
      };
    });
  }
}
