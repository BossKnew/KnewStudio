import './load-secret-files';
import Redis from 'ioredis';
import { createPrismaClient } from './prisma-client';
import { redisUrl } from './redis-config';
import { SESSION_PREFIX, USER_SESSIONS_PREFIX } from './domain-constants';

async function main() {
  const [username, confirmation] = process.argv.slice(2);
  if (!username || confirmation !== username) throw new Error('用法：npm run mfa:reset -- <username> <同一 username 再确认一次>');
  const prisma = createPrismaClient();
  const redis = new Redis(redisUrl(), { maxRetriesPerRequest: 1, protocol: 2 });
  try {
    const user = await prisma.user.findUnique({ where: { username }, select: { id: true, username: true } });
    if (!user) throw new Error('用户不存在');
    await prisma.$transaction([
      prisma.mfaCredential.deleteMany({ where: { userId: user.id } }),
      prisma.auditLog.create({ data: { action: 'operator.user.mfa.reset', targetType: 'user', targetId: user.id, metadata: { username: user.username } } }),
    ]);
    const sessionsKey = `${USER_SESSIONS_PREFIX}${user.id}`;
    const sessions = await redis.zrange(sessionsKey, '0', '-1');
    const tx = redis.multi();
    sessions.forEach((digest) => tx.del(`${SESSION_PREFIX}${digest}`));
    tx.del(sessionsKey);
    await tx.exec();
    process.stdout.write(`MFA reset for ${user.username}; active sessions revoked.\n`);
  } finally { await Promise.all([prisma.$disconnect(), redis.quit()]); }
}

void main().catch((error) => { process.stderr.write(`Offline MFA reset failed: ${error instanceof Error ? error.message : 'unknown error'}\n`); process.exitCode = 1; });
