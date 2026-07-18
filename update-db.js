const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function run() {
  try {
    console.log("Dropping existing leads to clean slate...");
    await pool.query('DELETE FROM gmaps_leads;');
    console.log("Adding new columns...");
    await pool.query('ALTER TABLE gmaps_leads ADD COLUMN IF NOT EXISTS batch_id VARCHAR(255);');
    await pool.query('ALTER TABLE gmaps_leads ADD COLUMN IF NOT EXISTS search_query VARCHAR(255);');
    console.log("Adding suggested_subject...");
    await pool.query('ALTER TABLE gmaps_leads ADD COLUMN IF NOT EXISTS suggested_subject TEXT;');
    console.log("Success!");
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
run();
