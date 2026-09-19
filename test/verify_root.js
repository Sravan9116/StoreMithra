async function test() {
  const urls = [
    'http://localhost:3000/',
    'http://localhost:3000/public/css/style.css',
    'http://localhost:3000/public/js/app.js'
  ];

  for (const url of urls) {
    const res = await fetch(url);
    const text = await res.text();
    console.log(`URL: ${url} -> Status: ${res.status}, Length: ${text.length} bytes`);
    if (res.status !== 200 || text.length === 0) {
      throw new Error(`Failed on ${url}`);
    }
  }
  console.log('✅ ALL ROOT & ASSET ENDPOINTS SERVING SUCCESSFULLY!');
}

test().catch(err => {
  console.error(err);
  process.exit(1);
});
