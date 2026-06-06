import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_UyTm6rXYJE9O@ep-frosty-feather-aog13l94-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

if (!connectionString) {
  console.error("Missing DATABASE_URL in environment variables.");
}

const pool = new Pool({
  connectionString,
});

export async function query(text: string, params?: any[]) {
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
  `;
  try {
    await pool.query(createTableQuery);
    await pool.query(alterTableQuery);
    console.log('Database initialized: gmaps_leads table is ready with all fields.');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}
