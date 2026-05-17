const http = require('http');

async function request(path, method, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-secret': 'propedge_secret_2026'
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);

    const req = http.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw || '{}') });
        } catch (e) {
          resolve({ status: res.statusCode, data: raw });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runAudit() {
  console.log('🚀 Starting Full System Audit...');

  // 1. Check Properties (Health)
  console.log('\n--- 1. API Health (Properties) ---');
  try {
    const props = await request('/api/ai/properties', 'GET');
    console.log('✅ API responds:', props.status === 200 ? 'OK' : 'FAIL (' + props.status + ')');
  } catch (e) { console.log('❌ API Check Failed:', e.message); }

  // 2. Submit Lead
  console.log('\n--- 2. Lead Submission ---');
  const leadPayload = {
    agentEmail: 'saishivaraju.m2002@gmail.com',
    lead: {
      name: 'Audit Lead',
      phone: '+919999911111',
      email: 'audit@example.com',
      property_interest: 'Skyview Residences',
      budget: '$1M - $3M'
    }
  };
  const leadRes = await request('/api/leads', 'POST', leadPayload);
  console.log('✅ Lead Response:', leadRes.data.success ? 'Success' : 'Fail');

  // 3. Verify Follow-ups Scheduled
  console.log('\n--- 3. Follow-up Status ---');
  const followRes = await request('/api/followups', 'GET');
  const followups = followRes.data.followups || [];
  const isScheduled = followups.some(f => f.phone === '+919999911111');
  console.log('✅ Follow-ups Scheduled:', isScheduled ? 'YES' : 'NO');

  // 4. Simulate Call Failure (Webhook)
  console.log('\n--- 4. Vapi Webhook (Call Failure) ---');
  const webhookPayload = {
    message: {
      type: 'end-of-call-report',
      endedReason: 'customer-did-not-answer',
      durationSeconds: 0,
      call: {
        id: 'audit_call_id',
        customer: { number: '+919999911111', name: 'Audit Lead' },
        metadata: { leadId: 'audit_lead_id', email: 'audit@example.com', interest: 'Skyview', budget: '$1M' }
      }
    }
  };
  const webRes = await request('/api/vapi/webhook', 'POST', webhookPayload);
  console.log('✅ Webhook Response:', webRes.data.received ? 'Success' : 'Fail');

  // 5. Verify Retry Scheduled
  console.log('\n--- 5. Retry System Status ---');
  const retryRes = await request('/api/retry-status', 'GET');
  console.log('✅ Retry Endpoint Status:', retryRes.status === 200 ? 'OK' : 'FAIL (' + retryRes.status + ')');
  
  console.log('\nAudit complete. Check server logs for detailed execution trace.');
}

runAudit();
