// Content validation for user uploads (SECURITY.md gap: no magic-number
// check before storage). Policy: accept files whose leading bytes match a
// known document/image signature, or that look like plain text (CSV, QIF,
// OFX...). Everything else — executables, unknown binary blobs — is rejected
// before it reaches the encrypted store.
// ponytail: signature whitelist, no malware scanning; bolt a scanner hook in
// here if that ever becomes a requirement.

const SIGNATURES: Array<{ type: string; matches: (b: Buffer) => boolean }> = [
  { type: 'pdf', matches: b => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { type: 'png', matches: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'jpeg', matches: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'gif', matches: b => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1')) },
  { type: 'webp', matches: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { type: 'tiff', matches: b => b.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || b.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a])) },
  { type: 'heic', matches: b => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  // Covers docx/xlsx/odt and plain .zip archives of statements.
  { type: 'zip', matches: b => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07) },
  // Legacy MS Office compound file (.doc/.xls).
  { type: 'ole', matches: b => b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) },
];

const REJECTED: Array<{ type: string; matches: (b: Buffer) => boolean }> = [
  { type: 'windows executable', matches: b => b[0] === 0x4d && b[1] === 0x5a },
  { type: 'ELF executable', matches: b => b.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) },
  { type: 'Mach-O executable', matches: b => [0xfeedface, 0xfeedfacf, 0xcafebabe].includes(b.readUInt32BE(0)) },
];

function looksLikeText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8192);
  let printable = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte !== 0x7f)) printable += 1;
  }
  return sample.length > 0 && printable / sample.length > 0.9;
}

export function validateUploadContent(buffer: Buffer): { ok: true; sniffed: string } | { ok: false; error: string } {
  if (buffer.length < 4) return { ok: false, error: 'The file is too small to be a document' };
  for (const sig of REJECTED) {
    if (sig.matches(buffer)) return { ok: false, error: `Executable files are not accepted (detected ${sig.type})` };
  }
  for (const sig of SIGNATURES) {
    if (sig.matches(buffer)) return { ok: true, sniffed: sig.type };
  }
  if (looksLikeText(buffer)) return { ok: true, sniffed: 'text' };
  return { ok: false, error: 'Unrecognized file content — upload a document, image, or text file' };
}
