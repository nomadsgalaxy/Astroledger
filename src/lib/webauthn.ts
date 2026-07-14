// WebAuthn (passkey) server config - @simplewebauthn/server v9 API.

import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { prisma } from './prisma';

const RP_NAME = 'Astroledger';

// Default RP_ID / ORIGIN - used when no per-request origin is threaded in
// (e.g. legacy callers). The tunneled deployment overrides these via env.
// IMPORTANT: a passkey is bound to one RP_ID at registration time. If the
// user signs up via the public tunnel hostname but later tries to sign in via
// localhost (or vice versa), authentication will fail by design - passkeys
// are origin-scoped. The per-request derivation below makes both flows work
// AS LONG AS registration and authentication happen on the same origin.
export const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
export const ORIGIN = process.env.WEBAUTHN_ORIGIN || 'http://localhost:5050';

// Derive (rpID, origin) from an incoming request's Host header. Behind a
// Cloudflare tunnel the Host is the public hostname; on direct local access
// it's localhost:5050. Forwarded headers from CF are honored.
export function deriveRpFromRequest(req: Request): { rpID: string; origin: string } {
  const h = req.headers;
  const forwardedHost  = h.get('x-forwarded-host');
  const forwardedProto = h.get('x-forwarded-proto');
  const host  = forwardedHost ?? h.get('host') ?? new URL(req.url).host;
  const proto = forwardedProto ?? (host.includes('localhost') ? 'http' : 'https');
  const rpID = host.split(':')[0];                  // strip :port - RP IDs are bare hostnames
  const origin = `${proto}://${host}`;
  return { rpID, origin };
}

export async function getRegistrationOptions(userId: string, email: string, opts: { rpID?: string } = {}) {
  const rpID = opts.rpID || RP_ID;
  const existing = await prisma.authenticator.findMany({ where: { userId } });
  const regOpts = await generateRegistrationOptions({
    rpName: RP_NAME, rpID,
    userID: userId,
    userName: email, userDisplayName: email,
    attestationType: 'none',
    excludeCredentials: existing.map(a => ({
      id: isoBase64URL.toBuffer(a.credentialID),
      type: 'public-key' as const,
      transports: a.transports ? JSON.parse(a.transports) : undefined,
    })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });
  // Persist the challenge AND the rpID we used; verify must match.
  await prisma.appSetting.upsert({
    where: { key: `webauthn_challenge:${userId}` },
    update: { value: JSON.stringify({ challenge: regOpts.challenge, rpID }) },
    create: { key: `webauthn_challenge:${userId}`, value: JSON.stringify({ challenge: regOpts.challenge, rpID }) },
  });
  return regOpts;
}

export async function verifyRegistration(userId: string, response: any, opts: { origin?: string; rpID?: string } = {}) {
  const row = await prisma.appSetting.findUnique({ where: { key: `webauthn_challenge:${userId}` } });
  if (!row) throw new Error('No pending challenge');
  // Backward-compat: older rows stored just the challenge string. New rows
  // store {challenge, rpID} JSON.
  let challenge: string; let storedRpID: string | undefined;
  try {
    const parsed = JSON.parse(row.value);
    if (parsed && typeof parsed === 'object' && 'challenge' in parsed) {
      challenge = parsed.challenge; storedRpID = parsed.rpID;
    } else { challenge = row.value; }
  } catch { challenge = row.value; }
  const expectedOrigin = opts.origin || ORIGIN;
  const expectedRPID   = opts.rpID || storedRpID || RP_ID;
  const result = await verifyRegistrationResponse({
    response, expectedChallenge: challenge, expectedOrigin, expectedRPID,
  });
  if (!result.verified || !result.registrationInfo) throw new Error('Registration verify failed');
  const r = result.registrationInfo;
  const credentialID = isoBase64URL.fromBuffer(r.credentialID);
  await prisma.authenticator.create({
    data: {
      credentialID,
      userId, providerAccountId: credentialID,
      credentialPublicKey: isoBase64URL.fromBuffer(r.credentialPublicKey),
      counter: r.counter,
      credentialDeviceType: r.credentialDeviceType,
      credentialBackedUp: r.credentialBackedUp,
      transports: response.response?.transports ? JSON.stringify(response.response.transports) : null,
    },
  });
  await prisma.appSetting.delete({ where: { key: `webauthn_challenge:${userId}` } });
  return true;
}

export async function getAuthenticationOptions(opts: { rpID?: string } = {}) {
  const rpID = opts.rpID || RP_ID;
  const allow = await prisma.authenticator.findMany();
  const authOpts = await generateAuthenticationOptions({
    rpID, userVerification: 'preferred',
    allowCredentials: allow.map(a => ({
      id: isoBase64URL.toBuffer(a.credentialID),
      type: 'public-key' as const,
      transports: a.transports ? JSON.parse(a.transports) : undefined,
    })),
  });
  await prisma.appSetting.upsert({
    where: { key: `webauthn_auth_challenge` },
    update: { value: JSON.stringify({ challenge: authOpts.challenge, rpID }) },
    create: { key: `webauthn_auth_challenge`, value: JSON.stringify({ challenge: authOpts.challenge, rpID }) },
  });
  return authOpts;
}

export async function verifyAuthentication(response: any, opts: { origin?: string; rpID?: string } = {}): Promise<string | null> {
  const cred = await prisma.authenticator.findUnique({ where: { credentialID: response.id } });
  if (!cred) return null;
  const row = await prisma.appSetting.findUnique({ where: { key: 'webauthn_auth_challenge' } });
  if (!row) return null;
  let challenge: string; let storedRpID: string | undefined;
  try {
    const parsed = JSON.parse(row.value);
    if (parsed && typeof parsed === 'object' && 'challenge' in parsed) {
      challenge = parsed.challenge; storedRpID = parsed.rpID;
    } else { challenge = row.value; }
  } catch { challenge = row.value; }
  const expectedOrigin = opts.origin || ORIGIN;
  const expectedRPID   = opts.rpID || storedRpID || RP_ID;
  const result = await verifyAuthenticationResponse({
    response, expectedChallenge: challenge, expectedOrigin, expectedRPID,
    authenticator: {
      credentialID: isoBase64URL.toBuffer(cred.credentialID),
      credentialPublicKey: isoBase64URL.toBuffer(cred.credentialPublicKey),
      counter: cred.counter,
      transports: cred.transports ? JSON.parse(cred.transports) : undefined,
    },
  });
  if (!result.verified) return null;
  await prisma.authenticator.update({
    where: { credentialID: cred.credentialID },
    data: { counter: result.authenticationInfo.newCounter },
  });
  await prisma.appSetting.delete({ where: { key: 'webauthn_auth_challenge' } }).catch(() => {});
  return cred.userId;
}
