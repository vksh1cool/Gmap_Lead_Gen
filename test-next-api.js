const http = require('http');

const req = http.request({
  hostname: 'localhost',
  port: 3001,
  path: '/api/scrape',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
}, (res) => {
  res.on('data', (chunk) => {
    console.log(`CHUNK RECEIVED: ${chunk.toString()}`);
  });
  res.on('end', () => {
    console.log('Stream ended');
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.write(JSON.stringify({
  niche: 'dentist',
  location: 'austin',
  limit: 2,
  apiKey: ''
}));
req.end();
