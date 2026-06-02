const fetch = require('node-fetch');

async function test() {
  const payload = {
    type: "end-of-call-report",
    call: {
      id: "test_call_" + Date.now(),
      metadata: {
        leadId: "mpv4twojvvrg",
        phone: "+12186561971"
      },
      customer: {
        number: "+12186561971",
        name: "sai"
      }
    },
    message: {
      type: "end-of-call-report",
      call: {
        id: "test_call_" + Date.now(),
        metadata: {
          leadId: "mpv4twojvvrg",
          phone: "+12186561971"
        },
        customer: {
          number: "+12186561971",
          name: "sai"
        }
      },
      durationSeconds: 0,
      endedReason: "customer-did-not-answer",
      transcript: ""
    }
  };
  
  console.log("🚀 Sending unanswered webhook payload to local server on port 5000...");
  try {
    const res = await fetch('http://localhost:5000/api/vapi/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log("Status:", res.status);
    console.log("Body:", await res.text());
  } catch (err) {
    console.error("❌ Request failed:", err.message);
  }
}
test();
