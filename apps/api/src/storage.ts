import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Env } from './env.js';

/**
 * Document storage (F-13c, ADR-013).
 *
 * F-13 made the wet-ink file's PREPARATION verifiable — every paper printed and
 * in the folder. It did not make the file itself verifiable: `status = 'signed'`
 * was still a person asserting that a signature exists somewhere. This is the
 * other half. A stored file has a SHA-256 recorded with it, and every read
 * recomputes that hash, so "this is the contract the customer signed" stops
 * being a claim and becomes something the system can check.
 *
 * Behind a driver because the answer differs by environment and neither answer
 * should leak into the routes: local disk in dev and CI, S3 (private bucket,
 * per-tenant prefix, presigned URLs) in deployed environments. The S3 driver is
 * NOT written yet — no bucket exists, the owner's instruction is that no paid
 * AWS resource is provisioned during the build, and a driver nobody can run
 * against the real service is a driver nobody has tested. `loadEnv` refuses to
 * boot production on the local driver, so the gap fails loudly rather than
 * silently writing contracts to an ephemeral disk.
 */

export interface StoredObject {
  readonly key: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface StorageDriver {
  readonly kind: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
}

export function sha256(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

/**
 * Keys are BUILT here from ids the server already trusts, never taken from a
 * request. The per-tenant prefix is what makes an S3 bucket policy able to
 * separate tenants at all (ADR-013), so it is not cosmetic.
 *
 * The content hash is part of the key: re-uploading the identical file is then
 * idempotent, and a corrected scan lands beside the original rather than
 * overwriting the evidence of what was there before.
 */
export function documentKey(
  orgId: string,
  dealId: string,
  documentId: string,
  hash: string,
  extension: string,
): string {
  return `org/${orgId}/deals/${dealId}/documents/${documentId}/${hash}.${extension}`;
}

class LocalStorage implements StorageDriver {
  readonly kind = 'local' as const;
  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    const full = resolve(this.root, key);
    // The keys are server-built, so this cannot fire today. It stays because
    // the day one is built from anything a user typed, "cannot" becomes "did
    // not" — and a traversal here writes outside the storage root.
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error(`Refusing a storage key that escapes the root: ${key}`);
    }
    return full;
  }

  // No content type: a file on disk has none, and the DB column is the record.
  // S3 needs it on the object, which is why the interface carries it.
  async put(key: string, body: Buffer): Promise<StoredObject> {
    const full = this.pathFor(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
    return { key, sha256: sha256(body), bytes: body.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }
}

export function createStorage(env: Env): StorageDriver {
  if (env.DOCUMENT_STORAGE_DRIVER === 's3') {
    // Reached only if someone sets s3 before the bucket and driver exist.
    // Failing here beats accepting uploads and dropping them.
    throw new Error(
      'DOCUMENT_STORAGE_DRIVER=s3 is not implemented yet — no bucket is provisioned (F-13c).',
    );
  }
  return new LocalStorage(resolve(process.cwd(), env.DOCUMENT_STORAGE_DIR));
}

/** What a document may be: the papers a dealership actually scans back in. */
export const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** 20 MB — a scanned multi-page contract, with room, and not a memory hazard. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
