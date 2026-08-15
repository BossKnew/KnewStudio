import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, fetch } from 'undici';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const BLOCKED_RANGES = new Set([
  'unspecified', 'broadcast', 'multicast', 'linkLocal', 'loopback', 'private',
  'reserved', 'carrierGradeNat', 'uniqueLocal', 'ipv4Mapped', 'rfc6145',
  'rfc6052', '6to4', 'teredo', 'deprecated', 'orchid2', 'amt', 'as112v4',
]);

const MAX_REDIRECTS = 3;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_GENERATION_RESPONSE_BYTES = 120 * 1024 * 1024;
export const MAX_ERROR_BYTES = 64 * 1024;

type Address = { address: string; family: 4 | 6 };

export function pinnedLookup(selected: Address) {
  return (_hostname: string, options: any, callback: (...args: any[]) => void) => {
    // Node/Undici requests all addresses when autoSelectFamily is enabled. In
    // that mode the callback must receive an array; returning the scalar form
    // makes Node interpret the family as an address and raises ERR_INVALID_IP_ADDRESS.
    if (options?.all) callback(null, [{ address: selected.address, family: selected.family }]);
    else callback(null, selected.address, selected.family);
  };
}

export interface SafeResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: Buffer;
  url: string;
}

export interface SafeFileResponse extends Omit<SafeResponse, 'body'> {
  body?: Buffer;
  filePath?: string;
  sizeBytes: number;
}

export interface SafeRequestInit {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  body?: any;
  signal?: AbortSignal;
  redirectPolicy?: 'same-origin' | 'any' | 'none';
}

function redirectTarget(current: URL, location: string | null, policy: NonNullable<SafeRequestInit['redirectPolicy']>, redirects: number) {
  if (!location || redirects >= MAX_REDIRECTS) throw new Error('Remote redirect is invalid or exceeds the limit');
  if (policy === 'none') throw new Error('Remote redirects are disabled');
  const target = new URL(location, current);
  if (policy === 'same-origin' && target.origin !== current.origin) throw new Error('Credentialed requests cannot redirect across origins');
  return target;
}

function redirectedRequest(status: number, method: NonNullable<SafeRequestInit['method']>, body: any, headers: Record<string, string>) {
  if ((status === 301 || status === 302 || status === 303) && method === 'POST') {
    const filtered = Object.fromEntries(Object.entries(headers).filter(([name]) => !['content-type', 'content-length', 'transfer-encoding'].includes(name.toLowerCase())));
    return { method: 'GET' as const, body: undefined, headers: filtered };
  }
  return { method, body, headers };
}

function redirectedHeaders(current: URL, target: URL, policy: NonNullable<SafeRequestInit['redirectPolicy']>, headers: Record<string, string>) {
  return policy === 'any' && current.origin !== target.origin ? {} : headers;
}

export const redirectSecurity = { redirectTarget, redirectedRequest, redirectedHeaders };

function csvSet(name: string) {
  return new Set((process.env[name] ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function normalizedIp(value: string) {
  let parsed = ipaddr.parse(value);
  if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) parsed = (parsed as ipaddr.IPv6).toIPv4Address();
  return parsed;
}

function isBlocked(address: string) {
  return BLOCKED_RANGES.has(normalizedIp(address).range());
}

function matchesCidr(address: string, rule: string) {
  if (!rule.includes('/')) return false;
  try {
    const parsed = normalizedIp(address);
    const [network, bits] = ipaddr.parseCIDR(rule);
    const normalizedNetwork = network.kind() === 'ipv6' && (network as ipaddr.IPv6).isIPv4MappedAddress()
      ? (network as ipaddr.IPv6).toIPv4Address()
      : network;
    return parsed.kind() === normalizedNetwork.kind() && parsed.match(normalizedNetwork, bits);
  } catch { return false; }
}

function hostAllowed(hostname: string, address: string, allowlist: Set<string>) {
  const host = hostname.toLowerCase();
  return allowlist.has(host) || allowlist.has(address.toLowerCase()) || [...allowlist].some((rule) => matchesCidr(address, rule));
}

@Injectable()
export class SafeHttpService {
  private readonly logger = new Logger(SafeHttpService.name);

  validateBaseUrl(value: unknown) {
    if (typeof value !== 'string' || value.length > 2048) throw new BadRequestException('Base URL 格式不正确');
    let url: URL;
    try { url = new URL(value); } catch { throw new BadRequestException('Base URL 格式不正确'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new BadRequestException('Base URL 只允许 HTTP/HTTPS，且不能包含凭据、查询或片段');
    }
    return url.toString().replace(/\/$/, '');
  }

  async request(rawUrl: string, init: SafeRequestInit, maxBytes: number, errorMaxBytes = maxBytes): Promise<SafeResponse> {
    let url = new URL(rawUrl);
    let method = init.method ?? 'GET';
    let body = init.body;
    let headers = { ...init.headers };
    const { redirectPolicy = 'none', ...fetchInit } = init;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const addresses = await this.validateTarget(url);
      const selected = addresses[0];
      const dispatcher = new Agent({ connect: {
        lookup: pinnedLookup(selected),
      }});
      try {
        const response = await fetch(url, {
          ...fetchInit,
          method,
          body,
          redirect: 'manual',
          dispatcher,
          headers: { ...headers, 'accept-encoding': 'identity' },
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location || redirects === MAX_REDIRECTS) throw new Error('远端重定向无效或次数过多');
          const target = redirectTarget(url, location, redirectPolicy, redirects);
          headers = redirectedHeaders(url, target, redirectPolicy, headers);
          url = target;
          ({ method, body, headers } = redirectedRequest(response.status, method, body, headers));
          continue;
        }
        const responseBody = await this.readBounded(response, response.ok ? maxBytes : errorMaxBytes);
        return { ok: response.ok, status: response.status, headers: response.headers, body: responseBody, url: url.toString() };
      } finally {
        await dispatcher.close();
      }
    }
    throw new Error('远端重定向次数过多');
  }

  async requestToFile(rawUrl: string, init: SafeRequestInit, destination: string, maxBytes: number, errorMaxBytes = maxBytes): Promise<SafeFileResponse> {
    let url = new URL(rawUrl);
    let method = init.method ?? 'GET';
    let body = init.body;
    let headers = { ...init.headers };
    const { redirectPolicy = 'none', ...fetchInit } = init;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const addresses = await this.validateTarget(url);
      const selected = addresses[0];
      const dispatcher = new Agent({ connect: { lookup: pinnedLookup(selected) } });
      try {
        const response = await fetch(url, {
          ...fetchInit,
          method,
          body,
          redirect: 'manual',
          dispatcher,
          headers: { ...headers, 'accept-encoding': 'identity' },
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location || redirects === MAX_REDIRECTS) throw new Error('远端重定向无效或次数过多');
          const target = redirectTarget(url, location, redirectPolicy, redirects);
          headers = redirectedHeaders(url, target, redirectPolicy, headers);
          url = target;
          ({ method, body, headers } = redirectedRequest(response.status, method, body, headers));
          continue;
        }
        if (!response.ok) {
          const responseBody = await this.readBounded(response, errorMaxBytes);
          return { ok: false, status: response.status, headers: response.headers, body: responseBody, sizeBytes: responseBody.length, url: url.toString() };
        }
        const sizeBytes = await this.writeBounded(response, destination, maxBytes);
        return { ok: true, status: response.status, headers: response.headers, filePath: destination, sizeBytes, url: url.toString() };
      } finally {
        await dispatcher.close();
      }
    }
    throw new Error('远端重定向次数过多');
  }

  private async validateTarget(url: URL): Promise<Address[]> {
    const privateAllowlist = csvSet('OUTBOUND_PRIVATE_ALLOWLIST');
    const httpAllowlist = csvSet('OUTBOUND_HTTP_ALLOWLIST');
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const portHost = `${hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
    const httpAllowed = httpAllowlist.has(hostname) || httpAllowlist.has(portHost);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && httpAllowed)) throw new Error('远端目标必须使用 HTTPS，内网 HTTP 需显式加入白名单');

    let addresses: Address[];
    if (isIP(hostname)) addresses = [{ address: hostname, family: isIP(hostname) as 4 | 6 }];
    else addresses = (await lookup(hostname, { all: true, verbatim: true })) as Address[];
    if (!addresses.length) throw new Error('远端主机无法解析');
    for (const item of addresses) {
      const privateTarget = isBlocked(item.address);
      const explicitlyPrivateAllowed = hostAllowed(hostname, item.address, privateAllowlist);
      if ((privateTarget && !explicitlyPrivateAllowed) || (url.protocol === 'http:' && (!privateTarget || !explicitlyPrivateAllowed))) {
        this.logger.warn(`blocked outbound target host=${hostname}`);
        throw new Error('远端目标地址不在允许范围内');
      }
    }
    return addresses;
  }

  private async readBounded(response: any, limit: number) {
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(declared) && declared > limit) {
      await response.body?.cancel();
      throw new Error('远端响应超过大小限制');
    }
    if (!response.body) return Buffer.alloc(0);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of response.body as any) {
      const buffer = Buffer.from(chunk);
      total += buffer.length;
      if (total > limit) {
        await response.body.cancel();
        throw new Error('远端响应超过大小限制');
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, total);
  }

  private async writeBounded(response: any, destination: string, limit: number) {
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(declared) && declared > limit) {
      await response.body?.cancel();
      throw new Error('远端响应超过大小限制');
    }
    if (!response.body) throw new Error('远端响应缺少内容');
    let total = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        total += chunk.length;
        callback(total > limit ? new Error('远端响应超过大小限制') : null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(response.body as any), limiter, createWriteStream(destination, { flags: 'wx' }));
      return total;
    } catch (error) {
      await rm(destination, { force: true });
      throw error;
    }
  }
}
