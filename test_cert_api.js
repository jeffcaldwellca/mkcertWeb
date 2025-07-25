// Simple Node.js script to test mkcertWeb certificate archive API
// Usage: node test_cert_api.js <server_url> <folder> <certName>

const fetch = require('node-fetch');

if (process.argv.length < 5) {
  console.error('Usage: node test_cert_api.js <server_url> <folder> <certName>');
  process.exit(1);
}

const serverUrl = process.argv[2].replace(/\/$/, '');
const folder = process.argv[3];
const certName = process.argv[4];

// Encode folder slashes as underscores for backend
const folderParam = folder.replace(/\//g, '_');
const endpoint = `${serverUrl}/certificates/${encodeURIComponent(folderParam)}/${encodeURIComponent(certName)}/archive`;

async function testArchive() {
  try {
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    if (!res.ok) {
      console.error('Error:', data.error || data);
    } else {
      console.log('Success:', data);
    }
  } catch (err) {
    console.error('Request failed:', err);
  }
}

testArchive();
