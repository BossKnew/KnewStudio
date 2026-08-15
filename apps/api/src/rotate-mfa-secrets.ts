import 'reflect-metadata';
import './load-secret-files';
import { PrismaClient } from '@prisma/client';
import { MfaCryptoService } from './mfa-crypto.service';

async function main() {
  const prisma = new PrismaClient();
  const crypto = new MfaCryptoService();
  try {
    const credentials = await prisma.mfaCredential.findMany();
    let rotated = 0;
    for (const credential of credentials) {
      if (!crypto.needsRotation(credential.encryptedSecret)) continue;
      const secret = crypto.decrypt(credential.encryptedSecret, credential.userId, 'credential');
      await prisma.mfaCredential.update({ where: { userId: credential.userId }, data: { encryptedSecret: crypto.encrypt(secret, credential.userId, 'credential') } });
      rotated += 1;
    }
    process.stdout.write(`Rotated ${rotated} MFA credentials.\n`);
  } finally { await prisma.$disconnect(); }
}

void main().catch((error) => { process.stderr.write(`MFA secret rotation failed: ${error instanceof Error ? error.message : 'unknown error'}\n`); process.exitCode = 1; });
