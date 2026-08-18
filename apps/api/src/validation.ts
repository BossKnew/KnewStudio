import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({ errorCode: 'INVALID_INPUT', message: '请求参数无效', issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) });
  }
  return result.data;
}

export const usernameSchema = z.string().min(3).max(32);
// Password strength is role-dependent and is validated in AuthService. Keeping
// structural validation permissive here lets clients receive the useful policy
// message instead of the generic "请求参数无效" response.
export const passwordSchema = z.string().min(1).max(128);
export const uuidSchema = z.string().uuid();
export const safeText = (max: number) => z.string().trim().min(1).max(max);
