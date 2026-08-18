import 'reflect-metadata';
import './load-secret-files';
import { createPrismaClient } from './prisma-client';
import { CryptoService } from './crypto.service';

async function main() {
  const prisma = createPrismaClient();
  const crypto = new CryptoService();
  try {
    const providers = await prisma.provider.findMany({ select: { id: true, encryptedApiKey: true, encryptedHeaders: true } });
    let rotated = 0;
    for (const provider of providers) {
      const data: { encryptedApiKey?: string; encryptedHeaders?: string } = {};
      if (crypto.needsRotation(provider.encryptedApiKey)) data.encryptedApiKey = crypto.encrypt(crypto.decrypt(provider.encryptedApiKey));
      if (provider.encryptedHeaders && crypto.needsRotation(provider.encryptedHeaders)) data.encryptedHeaders = crypto.encrypt(crypto.decrypt(provider.encryptedHeaders));
      if (Object.keys(data).length) { await prisma.provider.update({ where: { id: provider.id }, data }); rotated += 1; }
    }
    process.stdout.write(`Rotated ${rotated} provider records.\n`);
  } finally { await prisma.$disconnect(); }
}

void main().catch((error) => { process.stderr.write(`Provider secret rotation failed: ${error instanceof Error ? error.message : 'unknown error'}\n`); process.exitCode = 1; });
