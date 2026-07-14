import { describe, it, expect } from 'vitest';
import { classifySyncError, healthBadge } from '../src/lib/syncHealth';

describe('classifySyncError', () => {
  it('treats 401/403 + credential wording as auth_error', () => {
    expect(classifySyncError(new Error('Bridge rejected credentials (HTTP 401)')).status).toBe('auth_error');
    expect(classifySyncError(new Error('HTTP 403 forbidden')).status).toBe('auth_error');
    expect(classifySyncError(new Error('unauthorized')).status).toBe('auth_error');
  });
  it('treats fetch/DNS/timeout failures as network_error (transient)', () => {
    expect(classifySyncError(new Error('fetch failed')).status).toBe('network_error');
    expect(classifySyncError(new Error('getaddrinfo ENOTFOUND bridge.simplefin.org')).status).toBe('network_error');
    expect(classifySyncError(new Error('connect ETIMEDOUT')).status).toBe('network_error');
  });
  it('falls back to generic error for anything else', () => {
    expect(classifySyncError(new Error('unexpected JSON shape')).status).toBe('error');
    expect(classifySyncError('plain string').status).toBe('error');
  });
});

describe('healthBadge', () => {
  const base = { source: 'simplefin', accessToken: 'https://u:p@x', lastSyncError: null };
  it('file-import sources are ghost, never live', () => {
    const b = healthBadge({ source: 'csv', lastSyncedAt: null, lastSyncStatus: 'ok' });
    expect(b.tone).toBe('ghost');
    expect(b.label).toBe('File import');
  });
  it('simplefin without a token reads as Disconnected', () => {
    const b = healthBadge({ source: 'simplefin', accessToken: null, lastSyncedAt: new Date(), lastSyncStatus: 'ok' });
    expect(b.tone).toBe('warning');
    expect(b.label).toBe('Disconnected');
  });
  it('recent ok is success', () => {
    const b = healthBadge({ ...base, lastSyncedAt: new Date(Date.now() - 3600_000), lastSyncStatus: 'ok' });
    expect(b.tone).toBe('success');
    expect(b.label).toMatch(/Synced/);
  });
  it('ok but older than the stale window is a warning', () => {
    const b = healthBadge({ ...base, lastSyncedAt: new Date(Date.now() - 10 * 86400_000), lastSyncStatus: 'ok' });
    expect(b.tone).toBe('warning');
    expect(b.label).toMatch(/Stale/);
  });
  it('auth_error is a hard error badge', () => {
    const b = healthBadge({ ...base, lastSyncedAt: new Date(Date.now() - 86400_000), lastSyncStatus: 'auth_error' });
    expect(b.tone).toBe('error');
    expect(b.label).toBe('Auth failed');
  });
  it('never-synced live link is info, not error', () => {
    const b = healthBadge({ ...base, lastSyncedAt: null, lastSyncStatus: 'never' });
    expect(b.tone).toBe('info');
  });
});
