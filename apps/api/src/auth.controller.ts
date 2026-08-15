import { Body, Controller, Get, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { CurrentCsrf, CurrentUser, Public, type AuthUser } from './common';
import { parseBody, passwordSchema, usernameSchema } from './validation';
import { z } from 'zod';

const registrationCredentialsSchema = z.object({ username: usernameSchema, password: passwordSchema }).strict();
const loginCredentialsSchema = z.object({ username: usernameSchema, password: z.string().min(1).max(128), remember: z.boolean().optional() }).strict();
const changePasswordSchema = z.object({ currentPassword: z.string().max(128), newPassword: passwordSchema }).strict();
const profileSchema = z.object({ displayName: z.string().trim().min(1).max(50) }).strict();
const factorKindSchema = z.enum(['totp', 'recovery']);
const mfaVerifySchema = z.object({ code: z.string().min(6).max(64), kind: factorKindSchema }).strict();
const mfaConfirmSchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
const mfaSetupSchema = z.object({ currentPassword: z.string().min(1).max(128), currentCode: z.string().min(6).max(64).optional(), kind: factorKindSchema.optional() }).strict();
const mfaDisableSchema = z.object({ currentPassword: z.string().min(1).max(128), code: z.string().min(6).max(64), kind: factorKindSchema }).strict();
const recoveryRegenerateSchema = z.object({ currentPassword: z.string().min(1).max(128), code: z.string().regex(/^\d{6}$/) }).strict();

export function cookieSecure() { return process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_HTTP !== 'true'; }
export function cookieName() { return cookieSecure() ? '__Host-kv_session' : 'kv_session_dev'; }
export function mfaCookieName() { return cookieSecure() ? '__Host-kv_mfa' : 'kv_mfa_dev'; }

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public() @Get('registration')
  async registration() { return { enabled: await this.auth.registrationEnabled() }; }

  @Public() @Post('register')
  register(@Body() raw: unknown, @Req() request: Request) { const body = parseBody(registrationCredentialsSchema, raw); return this.auth.register(body.username, body.password, request.ip); }

  @Public() @Post('login')
  async login(@Body() raw: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const body = parseBody(loginCredentialsSchema, raw);
    const result = await this.auth.login(body.username, body.password, request.ip, body.remember === true);
    if (result.challenge) {
      this.setMfaCookie(response, result.challenge.token, result.challenge.maxAgeMs);
      return { next: result.next };
    }
    this.setSessionCookie(response, result.session.token, result.session.maxAgeMs);
    return { next: result.next, user: result.session.user, csrfToken: result.session.csrfToken };
  }

  @Public() @Post('mfa/verify')
  async verifyMfa(@Body() raw: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const body = parseBody(mfaVerifySchema, raw);
    const result = await this.auth.completeMfaLogin(request.cookies?.[mfaCookieName()], body.code, body.kind, request.ip ?? 'unknown');
    this.clearMfaCookie(response);
    this.setSessionCookie(response, result.session.token, result.session.maxAgeMs);
    return { next: result.next, user: result.session.user, csrfToken: result.session.csrfToken };
  }

  @Public() @Get('mfa/setup')
  setupInfo(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return this.auth.setupInfo(request.cookies?.[mfaCookieName()]);
  }

  @Post('mfa/setup/start')
  async startMfaSetup(@CurrentUser() user: AuthUser, @Body() raw: unknown, @Res({ passthrough: true }) response: Response) {
    const body = parseBody(mfaSetupSchema, raw);
    const challenge = await this.auth.beginMfaSetup(user.id, body.currentPassword, body.currentCode, body.kind);
    this.setMfaCookie(response, challenge.token, challenge.maxAgeMs);
    return { next: 'MFA_ENROLLMENT_REQUIRED' };
  }

  @Public() @Post('mfa/setup/confirm')
  async confirmMfaSetup(@Body() raw: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const body = parseBody(mfaConfirmSchema, raw);
    const result = await this.auth.confirmMfaSetup(request.cookies?.[mfaCookieName()], body.code);
    this.clearMfaCookie(response);
    this.setSessionCookie(response, result.session.token, result.session.maxAgeMs);
    return { next: result.next, user: result.session.user, csrfToken: result.session.csrfToken, recoveryCodes: result.recoveryCodes };
  }

  @Post('mfa/disable')
  async disableMfa(@CurrentUser() user: AuthUser, @Body() raw: unknown, @Res({ passthrough: true }) response: Response) {
    const body = parseBody(mfaDisableSchema, raw);
    await this.auth.disableMfa(user.id, body.currentPassword, body.code, body.kind);
    response.clearCookie(cookieName(), { path: '/', secure: cookieSecure(), sameSite: 'lax' });
    return { ok: true, reauthRequired: true };
  }

  @Post('mfa/recovery-codes/regenerate')
  async regenerateRecoveryCodes(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    const body = parseBody(recoveryRegenerateSchema, raw);
    return { recoveryCodes: await this.auth.regenerateRecoveryCodes(user.id, body.currentPassword, body.code) };
  }

  @Post('logout')
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request.cookies?.[cookieName()]);
    response.clearCookie(cookieName(), { path: '/', secure: cookieSecure(), sameSite: 'lax' });
    this.clearMfaCookie(response);
    return { ok: true };
  }

  @Get('me') me(@CurrentUser() user: AuthUser, @CurrentCsrf() csrfToken: string) { return { user, csrfToken }; }

  @Patch('profile')
  async updateProfile(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    const body = parseBody(profileSchema, raw);
    return { user: await this.auth.updateProfile(user.id, body.displayName) };
  }

  @Post('change-password')
  async changePassword(@CurrentUser() user: AuthUser, @Body() raw: unknown, @Res({ passthrough: true }) response: Response) {
    const body = parseBody(changePasswordSchema, raw);
    await this.auth.changePassword(user.id, body.currentPassword, body.newPassword);
    response.clearCookie(cookieName(), { path: '/', secure: cookieSecure(), sameSite: 'lax' });
    return { ok: true };
  }

  private setSessionCookie(response: Response, token: string, maxAge?: number) {
    response.cookie(cookieName(), token, { httpOnly: true, secure: cookieSecure(), sameSite: 'lax', path: '/', ...(maxAge === undefined ? {} : { maxAge }) });
  }

  private setMfaCookie(response: Response, token: string, maxAge: number) {
    response.cookie(mfaCookieName(), token, { httpOnly: true, secure: cookieSecure(), sameSite: 'lax', path: '/', maxAge });
  }

  private clearMfaCookie(response: Response) {
    response.clearCookie(mfaCookieName(), { path: '/', secure: cookieSecure(), sameSite: 'lax' });
  }
}
