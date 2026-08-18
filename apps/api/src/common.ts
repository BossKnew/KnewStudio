import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from './generated/prisma/client';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: Array<'USER' | 'ADMIN'>) => SetMetadata(ROLES, roles);

export type AuthUser = Pick<User, 'id' | 'username' | 'displayName' | 'role' | 'status' | 'mustChangePwd'> & { mfaEnabled: boolean; mfaRequired: boolean; groupIds: string[] };

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => context.switchToHttp().getRequest().user,
);

export const CurrentCsrf = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => context.switchToHttp().getRequest().sessionCsrf,
);

export function cleanUsername(value: unknown): string {
  if (typeof value !== 'string') throw new Error('用户名格式不正确');
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,32}$/.test(username)) {
    throw new Error('用户名仅支持 3-32 位小写字母、数字和下划线');
  }
  return username;
}

export function assertPassword(value: unknown, role: 'USER' | 'ADMIN' = 'ADMIN'): string {
  if (typeof value !== 'string' || value.length > 128) throw new Error('密码强度不够：密码不能超过 128 位');
  if (role === 'ADMIN') {
    if (value.length < 15) throw new Error('密码强度不够：管理员密码至少需要 15 位');
    return value;
  }
  if (value.length < 8 || !/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value) || !/[^A-Za-z0-9\s]/.test(value)) {
    throw new Error('密码强度不够：密码至少需要 8 位，并包含大写字母、小写字母、数字和特殊符号');
  }
  return value;
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return '未知错误';
}
