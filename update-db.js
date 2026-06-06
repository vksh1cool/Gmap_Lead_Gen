const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_UyTm6rXYJE9O@ep-frosty-feather-aog13l94-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
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
