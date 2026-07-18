const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it to .env.local (Neon serverless URL) and run with it loaded, e.g.:\n  node --env-file=.env.local init-db.js');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
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
      lead_score INT,
      lead_category VARCHAR(50),
      rationale TEXT,
      suggested_pitch TEXT,
      scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await pool.query(createTableQuery);
    console.log('Database initialized: gmaps_leads table is ready.');
  } catch (error) {
    console.error('Error initializing database:', error);
  } finally {
    pool.end();
  }
}

main();
