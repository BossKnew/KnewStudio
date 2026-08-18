import { CryptoService } from './crypto.service';
import { normalizeProviderHeaders } from './provider-headers';

export function providerRequestHeaders(crypto: CryptoService, provider: { encryptedApiKey: string; encryptedHeaders?: string | null }) {
  const headers: Record<string, string> = { Authorization: `Bearer ${crypto.decrypt(provider.encryptedApiKey)}` };
  if (provider.encryptedHeaders) Object.assign(headers, normalizeProviderHeaders(JSON.parse(crypto.decrypt(provider.encryptedHeaders))) ?? {});
  return headers;
}
