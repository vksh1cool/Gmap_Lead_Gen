const { spawn } = require('child_process');
const { Pool } = require('pg');
const readline = require('readline');

const connectionString = 'postgresql://neondb_owner:npg_UyTm6rXYJE9O@ep-frosty-feather-aog13l94-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const pool = new Pool({ connectionString });

async function run() {
  console.log("Starting python scraper...");
  const proc = spawn('curl', ['-s', '-N', 'http://127.0.0.1:8000/scrape?niche=plumber&location=austin&limit=15']);
  
  const rl = readline.createInterface({
    input: proc.stdout,
    terminal: false
  });

  rl.on('line', async (line) => {
    if (!line.trim()) return;
    try {
      const data = JSON.parse(line);
      if (data.type === 'info') {
        console.log("INFO:", data.message);
      } else if (data.name) {
        console.log("Got lead:", data.name);
        const id = Math.random().toString(36).substring(7);
        const q = `INSERT INTO gmaps_leads (id, name, address, phone, website, rating, reviews, category, emails_found, socials, about_snippet, is_claimed, lead_score, lead_category, rationale, suggested_pitch) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) ON CONFLICT (id) DO NOTHING`;
        const score = 8;
        const category = "Diamond";
        await pool.query(q, [id, data.name, data.address || null, data.phone || null, data.website || null, data.rating || null, data.reviews || null, data.category || null, data.emails_found || [], data.socials || [], data.about_snippet || null, data.is_claimed ?? null, score, category, "High value lead based on basic metrics", "We noticed your digital presence could use a boost..."]);
        console.log("Saved to DB:", data.name);
      }
    } catch(e) {
      console.error("Parse error:", e.message);
    }
  });

  proc.stderr.on('data', data => console.error(`stderr: ${data}`));
  
  proc.on('close', code => {
    console.log("Process exited with code", code);
    pool.end();
  });
}
run();
