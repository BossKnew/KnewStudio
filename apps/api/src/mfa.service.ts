import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { MfaCryptoService } from './mfa-crypto.service';
import { PrismaService } from './prisma.service';
import { RateLimitService } from './rate-limit.service';
import { RedisService } from './redis.service';
import { generateTotpSecret, totpUri, verifyTotp as checkTotp } from './totp';

const CHALLENGE_SECONDS = 5 * 60;
const CHALLENGE_ATTEMPTS = 5;
const RECOVERY_CODE_COUNT = 10;

type Challenge = {
  userId: string;
  purpose: 'LOGIN' | 'SETUP';
  pendingSecret?: string;
  replacing?: boolean;
  remember?: boolean;
};

@Injectable()
export class MfaService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private limits: RateLimitService,
    private crypto: MfaCryptoService,
  ) {}

  requiredFor(role: string) { return role === 'ADMIN'; }

  async createLoginChallenge(userId: string, remember = false) {
    return this.createChallenge({ userId, purpose: 'LOGIN', remember });
  }

  async createSetupChallenge(userId: string, replacing = false, remember = false) {
    const token = randomBytes(32).toString('base64url');
    const digest = this.digest(token);
    const secret = generateTotpSecret(20);
    const challenge: Challenge = {
      userId,
      purpose: 'SETUP',
      replacing,
      remember,
      pendingSecret: this.crypto.encrypt(secret, userId, `pending:${digest}`),
    };
    await this.storeChallenge(digest, challenge);
    return { token, maxAgeMs: CHALLENGE_SECONDS * 1000 };
  }

  async setupInfo(token: string | undefined) {
    const { challenge, digest } = await this.readChallenge(token, 'SETUP');
    const user = await this.prisma.user.findUnique({ where: { id: challenge.userId }, select: { username: true } });
    if (!user) throw new UnauthorizedException('验证请求已失效');
    const secret = this.pendingSecret(challenge, digest);
    const issuer = (process.env.MFA_ISSUER || 'KnewStudio').trim().slice(0, 64) || 'KnewStudio';
    const uri = totpUri({ issuer, label: user.username, secret });
    return { qrDataUrl: await QRCode.toDataURL(uri, { width: 240, margin: 1, errorCorrectionLevel: 'M' }), manualKey: secret, issuer };
  }

  async confirmSetup(token: string | undefined, code: string) {
    const { challenge, digest } = await this.readChallenge(token, 'SETUP', true);
    const secret = this.pendingSecret(challenge, digest);
    const result = checkTotp({ secret, token: code, window: 1 });
    if (!result.valid) throw new UnauthorizedException('动态码无效');
    const claimed = await this.claimChallenge(digest);
    if (!claimed) throw new UnauthorizedException('验证请求已失效');
    const recoveryCodes = this.generateRecoveryCodes();
    const encryptedSecret = this.crypto.encrypt(secret, challenge.userId, 'credential');
    await this.prisma.$transaction(async (tx) => {
      await tx.mfaCredential.upsert({
        where: { userId: challenge.userId },
        create: { userId: challenge.userId, encryptedSecret, lastAcceptedTimeStep: BigInt(result.timeStep) },
        update: { encryptedSecret, enabledAt: new Date(), lastAcceptedTimeStep: BigInt(result.timeStep) },
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { credentialId: challenge.userId } });
      await tx.mfaRecoveryCode.createMany({ data: recoveryCodes.map((value) => ({ credentialId: challenge.userId, codeHash: this.recoveryHash(value) })) });
      await tx.auditLog.create({ data: { actorId: challenge.userId, action: challenge.replacing ? 'user.mfa.replaced' : 'user.mfa.enabled', targetType: 'user', targetId: challenge.userId } });
    });
    return { userId: challenge.userId, recoveryCodes, remember: Boolean(challenge.remember) };
  }

  async verifyLoginChallenge(token: string | undefined, code: string, kind: 'totp' | 'recovery', ip: string) {
    await this.limits.consume('mfa-ip', ip, 30, 600);
    const { challenge, digest } = await this.readChallenge(token, 'LOGIN', true);
    if (kind === 'totp') {
      const verified = await this.verifyTotp(challenge.userId, code, false);
      if (!verified) throw new UnauthorizedException('动态码或恢复码无效');
      const claimed = await this.claimChallenge(digest);
      if (!claimed) throw new UnauthorizedException('验证请求已失效');
      if (!(await this.commitTimeStep(challenge.userId, verified.timeStep))) throw new UnauthorizedException('动态码已使用');
      return { userId: challenge.userId, method: 'totp' as const, remember: Boolean(challenge.remember) };
    }
    if (!(await this.hasRecoveryCode(challenge.userId, code))) throw new UnauthorizedException('动态码或恢复码无效');
    const claimed = await this.claimChallenge(digest);
    if (!claimed) throw new UnauthorizedException('验证请求已失效');
    if (!(await this.consumeRecoveryCode(challenge.userId, code))) throw new UnauthorizedException('恢复码已使用');
    await this.prisma.auditLog.create({ data: { actorId: challenge.userId, action: 'user.mfa.recovery_code.used', targetType: 'user', targetId: challenge.userId } });
    return { userId: challenge.userId, method: 'recovery' as const, remember: Boolean(challenge.remember) };
  }

  async verifyCurrentFactor(userId: string, code: string, kind: 'totp' | 'recovery' = 'totp') {
    if (kind === 'recovery') {
      const consumed = await this.consumeRecoveryCode(userId, code);
      if (consumed) await this.prisma.auditLog.create({ data: { actorId: userId, action: 'user.mfa.recovery_code.used', targetType: 'user', targetId: userId } });
      return consumed;
    }
    const verified = await this.verifyTotp(userId, code, false);
    return Boolean(verified && await this.commitTimeStep(userId, verified.timeStep));
  }

  async regenerateRecoveryCodes(userId: string) {
    const recoveryCodes = this.generateRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { credentialId: userId } }),
      this.prisma.mfaRecoveryCode.createMany({ data: recoveryCodes.map((value) => ({ credentialId: userId, codeHash: this.recoveryHash(value) })) }),
      this.prisma.auditLog.create({ data: { actorId: userId, action: 'user.mfa.recovery_codes.regenerated', targetType: 'user', targetId: userId } }),
    ]);
    return recoveryCodes;
  }

  async removeCredential(userId: string, actorId = userId, action = 'user.mfa.disabled') {
    await this.prisma.$transaction(async (tx) => {
      await tx.mfaCredential.deleteMany({ where: { userId } });
      await tx.auditLog.create({ data: { actorId, action, targetType: 'user', targetId: userId } });
    });
  }

  async rotateSecrets() {
    const credentials = await this.prisma.mfaCredential.findMany();
    let rotated = 0;
    for (const credential of credentials) {
      if (!this.crypto.needsRotation(credential.encryptedSecret)) continue;
      const secret = this.crypto.decrypt(credential.encryptedSecret, credential.userId, 'credential');
      await this.prisma.mfaCredential.update({ where: { userId: credential.userId }, data: { encryptedSecret: this.crypto.encrypt(secret, credential.userId, 'credential') } });
      rotated += 1;
    }
    return rotated;
  }

  private async verifyTotp(userId: string, token: string, includeCurrent = true): Promise<false | { timeStep: number }> {
    if (!/^\d{6}$/.test(token)) return false;
    const credential = await this.prisma.mfaCredential.findUnique({ where: { userId } });
    if (!credential) return false;
    const secret = this.crypto.decrypt(credential.encryptedSecret, userId, 'credential');
    const afterTimeStep = includeCurrent ? undefined : credential.lastAcceptedTimeStep === null ? undefined : Number(credential.lastAcceptedTimeStep);
    const result = checkTotp({ secret, token, window: 1, afterTimeStep });
    return result.valid ? { timeStep: result.timeStep } : false;
  }

  private async commitTimeStep(userId: string, timeStep: number) {
    const result = await this.prisma.mfaCredential.updateMany({
      where: { userId, OR: [{ lastAcceptedTimeStep: null }, { lastAcceptedTimeStep: { lt: BigInt(timeStep) } }] },
      data: { lastAcceptedTimeStep: BigInt(timeStep) },
    });
    return result.count === 1;
  }

  private async consumeRecoveryCode(userId: string, code: string) {
    const normalized = code.replace(/[-\s]/g, '').toUpperCase();
    if (!/^[A-F0-9]{32}$/.test(normalized)) return false;
    const result = await this.prisma.mfaRecoveryCode.updateMany({
      where: { credentialId: userId, codeHash: this.recoveryHash(normalized), consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return result.count === 1;
  }

  private async hasRecoveryCode(userId: string, code: string) {
    const normalized = code.replace(/[-\s]/g, '').toUpperCase();
    if (!/^[A-F0-9]{32}$/.test(normalized)) return false;
    return Boolean(await this.prisma.mfaRecoveryCode.findFirst({ where: { credentialId: userId, codeHash: this.recoveryHash(normalized), consumedAt: null }, select: { id: true } }));
  }

  private async createChallenge(challenge: Challenge) {
    const token = randomBytes(32).toString('base64url');
    await this.storeChallenge(this.digest(token), challenge);
    return { token, maxAgeMs: CHALLENGE_SECONDS * 1000 };
  }

  private async storeChallenge(digest: string, challenge: Challenge) {
    await this.redis.client.set(`mfa:v1:challenge:${digest}`, JSON.stringify(challenge), 'EX', CHALLENGE_SECONDS);
  }

  private async readChallenge(token: string | undefined, purpose: Challenge['purpose'], countAttempt = false) {
    if (!token) throw new UnauthorizedException('验证请求已失效');
    const digest = this.digest(token);
    const raw = await this.redis.client.get(`mfa:v1:challenge:${digest}`);
    if (!raw) throw new UnauthorizedException('验证请求已失效');
    let challenge: Challenge;
    try { challenge = JSON.parse(raw); } catch { throw new UnauthorizedException('验证请求已失效'); }
    if (challenge.purpose !== purpose || !challenge.userId) throw new UnauthorizedException('验证请求已失效');
    if (countAttempt) {
      const attemptKey = `mfa:v1:attempts:${digest}`;
      const attempts = await this.redis.client.incr(attemptKey);
      if (attempts === 1) await this.redis.client.expire(attemptKey, CHALLENGE_SECONDS);
      if (attempts > CHALLENGE_ATTEMPTS) {
        await this.redis.client.del(`mfa:v1:challenge:${digest}`, attemptKey);
        throw new UnauthorizedException('验证尝试次数过多，请重新登录');
      }
    }
    return { challenge, digest };
  }

  private async claimChallenge(digest: string) {
    const raw = await this.redis.client.getdel(`mfa:v1:challenge:${digest}`);
    await this.redis.client.del(`mfa:v1:attempts:${digest}`);
    return raw !== null;
  }

  private pendingSecret(challenge: Challenge, digest: string) {
    if (!challenge.pendingSecret) throw new BadRequestException('绑定请求无效');
    return this.crypto.decrypt(challenge.pendingSecret, challenge.userId, `pending:${digest}`);
  }

  private generateRecoveryCodes() {
    return Array.from({ length: RECOVERY_CODE_COUNT }, () => randomBytes(16).toString('hex').toUpperCase().match(/.{1,8}/g)!.join('-'));
  }

  private recoveryHash(code: string) {
    return createHash('sha256').update(code.replace(/[-\s]/g, '').toUpperCase()).digest('base64url');
  }

  private digest(token: string) { return createHash('sha256').update(token).digest('base64url'); }
}
