import { BadRequestException } from '@nestjs/common';
import { outboundTimeouts, pinnedLookup, preferRoutableAddress, redirectSecurity, SafeHttpService, tlsServername } from './safe-http.service';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

describe('outbound undici timeouts', () => {
  it('disables headers and body timeouts when the caller supplies an AbortSignal', () => {
    expect(outboundTimeouts(new AbortController().signal)).toEqual({ headersTimeout: 0, bodyTimeout: 0 });
    expect(outboundTimeouts()).toEqual({});
  });

  it('aligns undici timeouts with an explicit request timeout', () => {
    expect(outboundTimeouts(new AbortController().signal, 1_800_000)).toEqual({ headersTimeout: 1_800_000, bodyTimeout: 1_800_000 });
  });
});

describe('outbound address selection', () => {
  it('prefers IPv4 when both families are available', () => {
    expect(preferRoutableAddress([
      { address: '2001:db8::1', family: 6 },
      { address: '203.0.113.10', family: 4 },
    ])).toEqual([
      { address: '203.0.113.10', family: 4 },
      { address: '2001:db8::1', family: 6 },
    ]);
  });

});

describe('pinned DNS lookup', () => {
  it('returns an address array when Node requests all addresses', () => {
    const callback = jest.fn();
    pinnedLookup({ address: '203.0.113.10', family: 4 })('example.com', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: '203.0.113.10', family: 4 }]);
  });

  it('returns the scalar callback form for a normal lookup', () => {
    const callback = jest.fn();
    pinnedLookup({ address: '203.0.113.10', family: 4 })('example.com', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '203.0.113.10', 4);
  });

  it('returns every allowlisted address when Node requests all families', () => {
    const callback = jest.fn();
    pinnedLookup([
      { address: '2001:db8::1', family: 6 },
      { address: '203.0.113.10', family: 4 },
    ])('example.com', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [
      { address: '203.0.113.10', family: 4 },
      { address: '2001:db8::1', family: 6 },
    ]);
  });

  it('omits SNI for literal IP targets', () => {
    expect(tlsServername('dashscope.aliyuncs.com')).toBe('dashscope.aliyuncs.com');
    expect(tlsServername('203.0.113.10')).toBeUndefined();
  });
});

describe('SafeHttpService SSRF policy', () => {
  const originalPrivate = process.env.OUTBOUND_PRIVATE_ALLOWLIST;
  const originalHttp = process.env.OUTBOUND_HTTP_ALLOWLIST;
  const service = new SafeHttpService();

  afterEach(() => {
    process.env.OUTBOUND_PRIVATE_ALLOWLIST = originalPrivate;
    process.env.OUTBOUND_HTTP_ALLOWLIST = originalHttp;
  });

  it.each([
    'https://127.0.0.1/v1',
    'https://2130706433/v1',
    'https://[::1]/v1',
    'https://169.254.169.254/latest/meta-data',
  ])('blocks private, alternate, IPv6 and metadata targets: %s', async (url) => {
    await expect((service as any).validateTarget(new URL(url))).rejects.toThrow('不在允许范围');
  });

  it('requires both private and HTTP allowlists for an internal cleartext target', async () => {
    process.env.OUTBOUND_HTTP_ALLOWLIST = '127.0.0.1';
    process.env.OUTBOUND_PRIVATE_ALLOWLIST = '';
    await expect((service as any).validateTarget(new URL('http://127.0.0.1:8080/v1'))).rejects.toThrow('不在允许范围');
    process.env.OUTBOUND_PRIVATE_ALLOWLIST = '127.0.0.0/8';
    await expect((service as any).validateTarget(new URL('http://127.0.0.1:8080/v1'))).resolves.toEqual([{ address: '127.0.0.1', family: 4 }]);
  });

  it('rejects credentials, query strings and fragments in provider base URLs', () => {
    expect(() => service.validateBaseUrl('https://user:pass@example.com/v1')).toThrow(BadRequestException);
    expect(() => service.validateBaseUrl('https://example.com/v1?token=x')).toThrow(BadRequestException);
    expect(() => service.validateBaseUrl('https://example.com/v1#x')).toThrow(BadRequestException);
  });
});

describe('SafeHttpService bounded file streaming', () => {
  let root: string;
  const service = new SafeHttpService();
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'knewstudio-http-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  function response(body: Buffer) {
    return { headers: new Headers({ 'content-length': String(body.length) }), body: Readable.toWeb(Readable.from([body])) };
  }

  it('writes a response directly to disk within the byte limit', async () => {
    const destination = join(root, 'response.bin');
    await expect((service as any).writeBounded(response(Buffer.from('streamed')), destination, 16)).resolves.toBe(8);
    await expect(readFile(destination)).resolves.toEqual(Buffer.from('streamed'));
  });

  it('rejects an oversized response without retaining a partial file', async () => {
    const destination = join(root, 'oversized.bin');
    await expect((service as any).writeBounded(response(Buffer.from('too-large')), destination, 4)).rejects.toThrow('超过大小限制');
    await expect(readFile(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('SafeHttpService redirect credential policy', () => {
  it.each([
    'https://evil.example/next',
    'http://api.example.com/next',
    'https://api.example.com:8443/next',
  ])('rejects a cross-origin credential redirect to %s', (location) => {
    expect(() => redirectSecurity.redirectTarget(new URL('https://api.example.com/v1'), location, 'same-origin', 0)).toThrow('across origins');
  });

  it('allows relative same-origin redirects and anonymous cross-origin redirects', () => {
    expect(redirectSecurity.redirectTarget(new URL('https://api.example.com/v1'), '../v2', 'same-origin', 0).href).toBe('https://api.example.com/v2');
    expect(redirectSecurity.redirectTarget(new URL('https://api.example.com/v1'), 'https://cdn.example.net/image', 'any', 0).origin).toBe('https://cdn.example.net');
  });

  it('drops every caller-supplied header on an any-policy cross-origin redirect', () => {
    expect(redirectSecurity.redirectedHeaders(
      new URL('https://api.example.com/v1'), new URL('https://cdn.example.net/image'), 'any',
      { Authorization: 'Bearer secret', 'X-Custom-Secret': 'secret' },
    )).toEqual({});
  });

  it('drops the body and entity headers when a POST becomes GET', () => {
    expect(redirectSecurity.redirectedRequest(303, 'POST', 'secret-body', { Authorization: 'Bearer secret', 'Content-Type': 'application/json', 'Content-Length': '11' })).toEqual({
      method: 'GET', body: undefined, headers: { Authorization: 'Bearer secret' },
    });
  });
});
