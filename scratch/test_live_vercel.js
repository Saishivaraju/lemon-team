const fetch = require('node-fetch');

async function run() {
  const payload = {
    agentEmail: "saishivaraju.m2002@gmail.com",
    lead: {
      name: "Vercel Test Lead",
      phone: "+18002255288", // Using the toll-free number that worked
      email: "test@example.com",
      property_interest: "Test Property",
      status: "New",
      source: "Website"
    }
  };

  try {
    const res = await fetch('https://scaleover-lemon.vercel.app/api/leads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-secret': 'propedge_secret_2026'
      },
      body: JSON.stringify(payload)
    });
    
    const text = await res.text();
    console.log("Status:", res.status);
    console.log("Response:", text);
  } catch(e) {
    console.error("Error:", e);
  }
}
run();
