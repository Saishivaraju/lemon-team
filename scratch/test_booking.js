const fetch = require('node-fetch');
async function test() {
  const payload = {
    client_name: "Test User",
    client_phone: "+1234567890",
    client_email: "test@example.com",
    property_name: "Palm Villa Estate",
    visit_date: "2026-05-30",
    visit_time: "10:00 AM",
    status: 'pending',
    source: 'Website link'
  };
  const res = await fetch('http://localhost:3000/api/visits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentEmail: 'saishivaraju.m2002@gmail.com', visit: payload })
  });
  console.log(res.status, await res.text());
}
test();
