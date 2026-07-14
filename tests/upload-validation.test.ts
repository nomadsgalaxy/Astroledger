import { describe, expect, it } from 'vitest';
import { validateUploadContent } from '../src/lib/uploadValidation';

describe('validateUploadContent', () => {
  it('accepts common document and image formats by magic number', () => {
    const cases: Array<[string, Buffer]> = [
      ['pdf', Buffer.from('%PDF-1.7\n%âãÏÓ', 'latin1')],
      ['png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)])],
      ['jpeg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)])],
      ['zip', Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.alloc(16)])],
      ['ole', Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(16)])],
    ];
    for (const [expected, buffer] of cases) {
      const result = validateUploadContent(buffer);
      expect(result).toMatchObject({ ok: true, sniffed: expected });
    }
  });

  it('accepts plain text such as CSV and QIF', () => {
    expect(validateUploadContent(Buffer.from('date,amount,description\n2026-01-01,-4.50,Coffee\n'))).toMatchObject({ ok: true, sniffed: 'text' });
    expect(validateUploadContent(Buffer.from('!Type:Bank\nD1/1/2026\nT-4.50\n^\n'))).toMatchObject({ ok: true, sniffed: 'text' });
  });

  it('rejects executables and unknown binary blobs', () => {
    expect(validateUploadContent(Buffer.concat([Buffer.from('MZ', 'latin1'), Buffer.alloc(64)])).ok).toBe(false);
    expect(validateUploadContent(Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(64)])).ok).toBe(false);
    const noise = Buffer.from(Array.from({ length: 256 }, (_, i) => (i * 37) % 256));
    expect(validateUploadContent(noise).ok).toBe(false);
    expect(validateUploadContent(Buffer.from([0x00, 0x01])).ok).toBe(false);
  });
});
