import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

/**
 * Unified Postgres access.
 *
 * Connection string precedence:
 *   1. DATABASE_URL env var (the way a team shares config via .env.local)
 *   2. A URL saved through the Settings → Database UI (gitignored db_config.json)
 *
 * No credential is hardcoded — an open-source clone must supply its own Neon
 * (or any Postgres) serverless URL. If none is configured, queries throw
 * DbNotConfiguredError and callers degrade gracefully instead of crashing.
 */

const CONFIG_FILE = path.join(process.cwd(), 'db_config.json');

export class DbNotConfiguredError extends Error {
  constructor() {
    super('No database configured. Set DATABASE_URL in .env.local or add a Neon URL in Settings → Database.');
    this.name = 'DbNotConfiguredError';
  }
}

function savedUrl(): string | null {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const u = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).url;
      if (u && String(u).trim()) return String(u).trim();
    }
  } catch { /* ignore */ }
  return null;
}

export function connectionSource(): 'env' | 'saved' | null {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) return 'env';
  if (savedUrl()) return 'saved';
  return null;
}

export function getConnectionString(): string | null {
  return (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) || savedUrl() || null;
}

export function isDbConfigured(): boolean {
  return !!getConnectionString();
}

/** Mask a connection string for display (hide the password). */
export function maskConnectionString(cs: string): string {
  try {
    return cs.replace(/:\/\/([^:]+):([^@]+)@/, (_m, user) => `://${user}:••••@`);
  } catch {
    return '••••';
  }
}

// Lazy pool, recreated if the configured URL changes (e.g. saved via UI).
let pool: Pool | null = null;
let poolUrl: string | null = null;
let schemaReady: Promise<void> | null = null;

function getPool(): Pool | null {
  const cs = getConnectionString();
  if (!cs) return null;
  if (!pool || poolUrl !== cs) {
    if (pool) pool.end().catch(() => {});
    pool = new Pool({ connectionString: cs });
    poolUrl = cs;
    schemaReady = null; // force a schema (re-)init against the new database
  }
  return pool;
}

/** Persist a UI-supplied URL (used only when DATABASE_URL env is absent). */
export function saveDbUrl(url: string) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ url: url.trim() }, null, 2));
  // Invalidate the pool so the next query reconnects with the new URL.
  if (pool) { pool.end().catch(() => {}); pool = null; poolUrl = null; schemaReady = null; }
}

export function clearSavedDbUrl() {
  try { fs.unlinkSync(CONFIG_FILE); } catch { /* ignore */ }
  if (pool) { pool.end().catch(() => {}); pool = null; poolUrl = null; schemaReady = null; }
}

/** Live health check. Returns ok + optional error, without throwing. */
export async function pingDb(): Promise<{ ok: boolean; configured: boolean; source: string | null; error?: string; masked?: string }> {
  const cs = getConnectionString();
  const source = connectionSource();
  if (!cs) return { ok: false, configured: false, source: null };
  const p = getPool();
  try {
    await p!.query('SELECT 1');
    return { ok: true, configured: true, source, masked: maskConnectionString(cs) };
  } catch (e: any) {
    return { ok: false, configured: true, source, error: e.message, masked: maskConnectionString(cs) };
  }
}

/** Validate a candidate connection string by opening a throwaway connection. */
export async function testDbUrl(url: string): Promise<{ ok: boolean; error?: string }> {
  url = (url || '').trim();
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    return { ok: false, error: 'URL must start with postgresql:// (copy the Neon connection string).' };
  }
  const tmp = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 8000 });
  try {
    await tmp.query('SELECT 1');
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  } finally {
    tmp.end().catch(() => {});
  }
}

function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = initDB().catch((e) => {
      schemaReady = null; // allow a retry on the next query
      console.error('Schema init failed:', e);
    });
  }
  return schemaReady;
}

export async function query(text: string, params?: any[]) {
  const p = getPool();
  if (!p) throw new DbNotConfiguredError();
  await ensureSchema();
  return p.query(text, params);
}

// Initialize / upgrade the unified leads table. Idempotent.
export async function initDB() {
  const p = getPool();
  if (!p) throw new DbNotConfiguredError();
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS gmaps_leads (
      id VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      address TEXT,
      phone VARCHAR(100),
      website TEXT,
      rating VARCHAR(50),
      reviews VARCHAR(50),
      category VARCHAR(50),
      emails_found TEXT[],
      socials TEXT[],
      about_snippet TEXT,
      is_claimed BOOLEAN DEFAULT TRUE,
      lead_score INT,
      lead_category VARCHAR(50),
      rationale TEXT,
      suggested_pitch TEXT,
      status VARCHAR(50) DEFAULT 'Uncontacted',
      scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  const alterTableQuery = `
    ALTER TABLE gmaps_leads ADD COLUMN IF NOT EXISTS socials TEXT[];
    ALTER TABLE gmaps_leads ADD COLUMN IF NOT EXISTS about_snippet TEXT;
    ALTER TABLE gmaps_leads ADD COLUMN IF NOT EXISTS is_claimed BOOLEAN DEFAULT TRUE;
    ALTER TABLE gmaps_leads ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'Uncontacted';
    ALTER TABLE gmaps_leads ADD COLUMN IF NOT EXISTS platform VARCHAR(50) DEFAULT 'gmaps';
    ALTER TABLE gmaps_leads ADD COLUMN IF NOT EXISTS external_id TEXT;
    ALTER TABLE gmaps_leads ADD COLUMN IF NOT EXISTS kind VARCHAR(20) DEFAULT 'business_listing';
    ALTER TABLE gmaps_leads ADD COLUMN IF NOT EXISTS author TEXT;
    ALTER TABLE gmaps_leads ADD COLUMN IF NOT EXISTS author_url TEXT;
    ALTER TABLE gmaps_leads ADD COLUMN IF NOT EXISTS post_url TEXT;
    ALTER TABLE gmaps_leads ADD COLUMN IF NOT EXISTS post_content TEXT;
    ALTER TABLE gmaps_leads ADD COLUMN IF NOT EXISTS title TEXT;
    ALTER TABLE gmaps_leads ADD COLUMN IF NOT EXISTS matched_keyword TEXT;
    ALTER TABLE gmaps_leads ADD COLUMN IF NOT EXISTS pain_point TEXT;
    ALTER TABLE gmaps_leads ADD COLUMN IF NOT EXISTS posted_at TIMESTAMP;
    ALTER TABLE gmaps_leads ADD COLUMN IF NOT EXISTS suggested_subject TEXT;
    ALTER TABLE gmaps_leads ADD COLUMN IF NOT EXISTS batch_id TEXT;
    ALTER TABLE gmaps_leads ADD COLUMN IF NOT EXISTS search_query TEXT;
    ALTER TABLE gmaps_leads ADD COLUMN IF NOT EXISTS group_name TEXT;
    ALTER TABLE gmaps_leads ADD COLUMN IF NOT EXISTS location TEXT;
    ALTER TABLE gmaps_leads ADD COLUMN IF NOT EXISTS google_maps_url TEXT;
  `;
  try {
    await p.query(createTableQuery);
    await p.query(alterTableQuery);
    console.log('Database initialized: gmaps_leads table is ready with all fields.');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}
