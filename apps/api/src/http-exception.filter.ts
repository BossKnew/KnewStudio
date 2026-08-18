import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception.getStatus();
    const payload = exception.getResponse();
    const body = typeof payload === 'string' ? { statusCode: status, message: payload } : payload as Record<string, unknown>;
    const retryAfter = Number(body.retryAfterSeconds ?? 0);
    if (status === 429 && Number.isFinite(retryAfter) && retryAfter > 0) response.setHeader('Retry-After', Math.ceil(retryAfter));
    response.status(status).json(body);
  }
}
