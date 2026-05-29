require('dotenv').config({ path: '../.env' });
const http = require('http');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';

async function simulateWebhook(callId, transcript, endReason = 'customer-ended-call') {
  console.log(`\n=========================================`);
  console.log(`🤖 Simulating Vapi Webhook: ${callId}`);
  console.log(`=========================================`);

  const payload = {
    message: {
      type: 'end-of-call-report',
      call: { id: callId },
      endedReason: endReason,
      transcript: transcript || 'Client: Hello. AI: Hi! Client: I want to book a visit for tomorrow at 10 AM. AI: Perfect.',
      recordingUrl: 'https://vapi.ai/mock-recording.mp3',
    }
  };

  const options = {
    hostname: 'localhost',
    port: 5000,
    path: '/api/vapi/webhook',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-vapi-secret': process.env.VAPI_WEBHOOK_SECRET || 'test' // if applicable
    }
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`✅ Webhook Response Status: ${res.statusCode}`);
        try {
          console.log(`✅ Webhook Response Body:`, JSON.parse(data));
        } catch(e) {
          console.log(`✅ Webhook Response Body:`, data);
        }
        resolve(data);
      });
    });

    req.on('error', (e) => {
      console.error(`❌ Webhook Error: ${e.message}`);
      reject(e);
    });

    req.write(JSON.stringify(payload));
    req.end();
  });
}

// Example Usage to simulate a campaign
async function runCampaignTest() {
  console.log("Starting Simulated Campaign Run...");
  
  // 1. Simulate First Call Ending (Successfully booked)
  await simulateWebhook('sim_call_1001', 'Client: Book a visit for 10am. AI: Confirmed.');
  
  console.log("\nWaiting 5 seconds for sequential queue to trigger next call...");
  await new Promise(r => setTimeout(r, 5000));
  
  // 2. Simulate Second Call Ending (No answer / voicemail)
  await simulateWebhook('sim_call_1002', '[Voicemail beep]', 'voicemail');

  console.log("\nWaiting 5 seconds for sequential queue to trigger next call...");
  await new Promise(r => setTimeout(r, 5000));

  // 3. Simulate Third Call Ending (Interested, follow up later)
  await simulateWebhook('sim_call_1003', 'Client: Send me an email and call me tomorrow.', 'customer-ended-call');
  
  console.log("\nSimulated Campaign Flow Completed.");
}

runCampaignTest();
