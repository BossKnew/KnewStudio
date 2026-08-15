import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { allowedOrigins, isProduction, validateSecurityConfig } from './security-config';
import { HttpExceptionFilter } from './http-exception.filter';
import { noStoreByDefault } from './cache-policy';

async function bootstrap() {
  validateSecurityConfig();
  const app = await NestFactory.create(AppModule);
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));
  app.use(noStoreByDefault);
  app.use((request: any, response: any, next: any) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const configured = allowedOrigins();
      const rawOrigin = request.headers.origin;
      if (!rawOrigin && isProduction()) return response.status(403).json({ errorCode: 'ORIGIN_REQUIRED', message: '请求来源无效' });
      if (rawOrigin) {
        let origin: string;
        try { origin = new URL(rawOrigin).origin; } catch { return response.status(403).json({ errorCode: 'ORIGIN_INVALID', message: '请求来源无效' }); }
        const developmentOrigin = `${request.protocol}://${request.get('host')}`;
        if (!(configured.has(origin) || (!configured.size && !isProduction() && origin === developmentOrigin))) return response.status(403).json({ errorCode: 'ORIGIN_INVALID', message: '请求来源无效' });
      }
    }
    next();
  });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 4000), '0.0.0.0');
}

void bootstrap();
