import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_UyTm6rXYJE9O@ep-frosty-feather-aog13l94-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

if (!connectionString) {
  console.error("Missing DATABASE_URL in environment variables.");
}

const pool = new Pool({
  connectionString,
});

// Lazily ensure the schema exists/upgraded exactly once per process, so a fresh
// Neon DB (or a deploy that adds columns) self-heals on first query instead of
// silently 500-ing with "column ... does not exist".
let schemaReady: Promise<void> | null = null;
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = initDB().catch((e) => {
      // Don't permanently cache a failure — allow a retry on the next query.
      schemaReady = null;
      console.error('Schema init failed:', e);
    });
  }
  return schemaReady;
}

export async function query(text: string, params?: any[]) {
  await ensureSchema();
  return pool.query(text, params);
}

// Function to initialize the database table if it doesn't exist
export async function initDB() {
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
  `;
  try {
    await pool.query(createTableQuery);
    await pool.query(alterTableQuery);
    console.log('Database initialized: gmaps_leads table is ready with all fields.');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}
