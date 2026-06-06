const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_UyTm6rXYJE9O@ep-frosty-feather-aog13l94-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
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
