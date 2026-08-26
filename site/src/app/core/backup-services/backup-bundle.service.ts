import { Injectable } from '@angular/core';
import { CURRENT_SQLITE_SCHEMA_VERSION } from '../../../shared/schema-version';

export const CURRENT_BACKUP_SCHEMA_VERSION = CURRENT_SQLITE_SCHEMA_VERSION;

export interface BackupBundle {
  version: 1;
  createdAtUtc: string;
  schemaVersion: number;
  data: string;
  dataHash: string;
  applicationVersion: string;
  companyId?: string;
  databaseBase64?: string;
  databaseHash?: string;
}

@Injectable()
export class BackupBundleService {
  private attemptedAtUtc?: string;
  private verifiedAtUtc?: string;

  create(data: string, schemaVersion = CURRENT_BACKUP_SCHEMA_VERSION, metadata: { companyId?: string; databaseBytes?: Uint8Array } = {}): string {
    this.attemptedAtUtc = new Date().toISOString();
    const databaseBase64 = metadata.databaseBytes ? this.base64(metadata.databaseBytes) : undefined;
    const bundle: BackupBundle = { version: 1, createdAtUtc: this.attemptedAtUtc, schemaVersion, data, dataHash: this.hash(data), applicationVersion: '0.0.0', companyId: metadata.companyId, databaseBase64, databaseHash: databaseBase64 ? this.hash(databaseBase64) : undefined };
    return JSON.stringify(bundle);
  }

  verify(bundleText: string): { valid: boolean; reason?: string; bundle?: BackupBundle } {
    let bundle: BackupBundle;
    try { bundle = JSON.parse(bundleText) as BackupBundle; } catch { return { valid: false, reason: 'Backup is not valid JSON.' }; }
    if (bundle.version !== 1 || typeof bundle.data !== 'string' || typeof bundle.dataHash !== 'string' || typeof bundle.applicationVersion !== 'string' || !Number.isInteger(bundle.schemaVersion) || bundle.schemaVersion < 1 || bundle.schemaVersion > CURRENT_BACKUP_SCHEMA_VERSION) return { valid: false, reason: 'Unsupported or incomplete backup bundle.' };
    if (bundle.dataHash !== this.hash(bundle.data)) return { valid: false, reason: 'Backup data hash does not match.' };
    if (bundle.databaseBase64 && bundle.databaseHash !== this.hash(bundle.databaseBase64)) return { valid: false, reason: 'Backup database hash does not match.' };
    try {
      const data = JSON.parse(bundle.data) as { version?: number; schemaVersion?: number; company?: { id?: string }; accounts?: unknown[]; transactions?: unknown[]; audit?: unknown[] };
      if (data.version !== 1 || !data.company?.id || !Array.isArray(data.accounts) || !Array.isArray(data.transactions) || !Array.isArray(data.audit)) return { valid: false, reason: 'Backup data is incomplete.' };
      if (!Number.isInteger(data.schemaVersion) || data.schemaVersion !== bundle.schemaVersion) return { valid: false, reason: 'Backup manifest and payload schema versions do not match.' };
      if (bundle.companyId && bundle.companyId !== data.company.id) return { valid: false, reason: 'Backup company identity does not match its manifest.' };
    } catch { return { valid: false, reason: 'Backup data is not valid JSON.' }; }
    this.verifiedAtUtc = new Date().toISOString();
    return { valid: true, bundle };
  }

  status(): { attemptedAtUtc?: string; verifiedAtUtc?: string } {
    return { attemptedAtUtc: this.attemptedAtUtc, verifiedAtUtc: this.verifiedAtUtc };
  }

  private hash(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
    return `fnv1a-${(hash >>> 0).toString(16)}`;
  }

  private base64(bytes: Uint8Array): string {
    let value = '';
    for (const byte of bytes) value += String.fromCharCode(byte);
    return btoa(value);
  }
}
