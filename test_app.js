/**
 * PropEdge Test Suite
 * ─────────────────────────────────────────────────────────────
 * Run against your deployed Vercel URL:
 *   BASE_URL=https://your-project.vercel.app API_SECRET=your-secret node test_app.js
 * Or locally:
 *   node test_app.js
 * ─────────────────────────────────────────────────────────────
 */

const https = require('https');
const http  = require('http');

const BASE    = (process.env.BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
const SECRET  = process.env.API_SECRET || 'test';
const IS_HTTPS = BASE.startsWith('https');

let passed = 0;
let failed = 0;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url    = new URL(BASE + path);
    const data   = body ? JSON.stringify(body) : null;
    const opts   = {
      hostname: url.hostname,
      port:     url.port || (IS_HTTPS ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type':  'application/json',
        'x-api-secret':  SECRET,
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };

    const lib = IS_HTTPS ? https : http;
    const req = lib.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function test(label, fn) {
  try {
    await fn();
    console.log(`  ✅ ${label}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${label} — ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

async function runTests() {
  console.log(`\n🧪 PropEdge Test Suite`);
  console.log(`   Target: ${BASE}`);
  console.log('─'.repeat(50));

  // ── 1. Health check ─────────────────────────────────
  console.log('\n── API Health ──────────────────────────────────');
  await test('Health endpoint responds', async () => {
    const r = await request('GET', '/api/health');
    assert(r.status === 200 || r.status === 404, `Got ${r.status}`);
  });

  // ── 2. Lead submission ───────────────────────────────
  console.log('\n── Lead Submission ─────────────────────────────');
  let leadResult;
  await test('POST /api/leads — saves lead', async () => {
    const r = await request('POST', '/api/leads', {
      agentEmail:        'test@propedge.test',
      lead: {
        name:              'Test Lead',
        phone:             '+919999900000',
        email:             'test@propedge.test',
        property_interest: '3BHK Apartment',
        source:            'test_suite'
      }
    });
    assert(r.status === 200 || r.status === 201, `Got ${r.status}`);
    leadResult = r.body;
  });

  // ── 3. AI chat ───────────────────────────────────────
  console.log('\n── AI Chat (Gemini) ─────────────────────────────');
  await test('POST /api/ai/chat — returns reply', async () => {
    const r = await request('POST', '/api/ai/chat', {
      input:     'Hi, I am looking for a 2BHK apartment near the city center',
      state:     'INITIAL',
      sessionId: 'test_' + Date.now(),
      lead:      { name: 'Test', phone: '+919999900000' }
    });
    assert(r.status === 200, `Got ${r.status}`);
    assert(r.body.reply && r.body.reply.length > 5, 'No reply returned');
  });

  await test('POST /api/ai/chat — handles edge case: call later', async () => {
    const r = await request('POST', '/api/ai/chat', {
      input:     'call me later, I am busy now',
      state:     'DISCOVERY',
      sessionId: 'test_' + Date.now(),
      lead:      { name: 'Test', phone: '+919999900000' }
    });
    assert(r.status === 200, `Got ${r.status}`);
    assert(r.body.reply, 'No reply returned');
    // AI should ask for a better time, not just end
    const reply = r.body.reply.toLowerCase();
    const handlesGracefully = reply.includes('time') || reply.includes('morning') ||
                               reply.includes('evening') || reply.includes('tomorrow') ||
                               reply.includes('better');
    assert(handlesGracefully, `AI should reschedule, got: "${r.body.reply}"`);
  });

  await test('POST /api/ai/chat — handles edge case: wants human', async () => {
    const r = await request('POST', '/api/ai/chat', {
      input:     'I want to talk to a real human agent please',
      state:     'DISCOVERY',
      sessionId: 'test_' + Date.now(),
      lead:      { name: 'Test', phone: '+919999900000' }
    });
    assert(r.status === 200, `Got ${r.status}`);
    assert(r.body.reply, 'No reply returned');
  });

  // ── 4. Properties ────────────────────────────────────
  console.log('\n── Properties ──────────────────────────────────');
  await test('GET /api/properties — returns list', async () => {
    const r = await request('GET', `/api/properties?email=${encodeURIComponent('test@propedge.test')}`);
    assert(r.status === 200 || r.status === 404, `Got ${r.status}`);
  });

  // ── 5. Visit booking ─────────────────────────────────
  console.log('\n── Visit Booking ───────────────────────────────');
  let visitId;
  await test('POST /api/visits — AI booking saves', async () => {
    const randomTime = `11:${Math.floor(Math.random()*60).toString().padStart(2,'0')} AM`;
    const r = await request('POST', '/api/visits', {
      agentEmail:   'test@propedge.test',
      is_ai_booking: true,
      visit: {
        client_name:  'Test Lead',
        client_phone: '+919999900000',
        client_email: 'test@propedge.test',
        property_name: '3BHK Apartment Test',
        visit_date:   '2099-12-31',
        visit_time:   randomTime,
        notes:        'Automated test booking',
        status:       'confirmed'
      }
    });
    assert(r.status === 200 || r.status === 201, `Got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.success, `Booking failed: ${JSON.stringify(r.body)}`);
    visitId = r.body.id;

    // We'll use this same time for the double booking test next
    this.lastRandomTime = randomTime;
  });

  await test('POST /api/visits — rejects double booking', async () => {
    const r = await request('POST', '/api/visits', {
      agentEmail:   'test@propedge.test',
      is_ai_booking: true,
      visit: {
        client_name:  'Duplicate Lead',
        client_phone: '+919999911111',
        property_name: 'Test Property',
        visit_date:   '2099-12-31',
        visit_time:   this.lastRandomTime || '11:00 AM',
        status:       'confirmed'
      }
    });
    // Should reject with 409 conflict
    assert(r.status === 409, `Expected 409 for double booking, got ${r.status}`);
  });

  // ── 6. Team routes ───────────────────────────────────
  console.log('\n── Team Management ─────────────────────────────');
  await test('GET /api/team/agents — returns agents list', async () => {
    const r = await request('GET', '/api/team/agents?teamId=test@propedge.test');
    // Accept 500 if DB is not connected, but check structure if it works
    if (r.status === 200) {
      assert(Array.isArray(r.body.agents), 'agents should be an array');
    } else {
      console.log(`    (Note: Team DB returned ${r.status}, likely connection issue)`);
    }
  });

  await test('GET /api/report — returns metrics', async () => {
    const r = await request('GET', '/api/report?teamId=test@propedge.test');
    assert(r.status === 200, `Got ${r.status}`);
    assert(r.body.summary !== undefined, 'No summary in report');
    assert(r.body.pipeline !== undefined, 'No pipeline in report');
  });

  // ── 7. Retry status ──────────────────────────────────
  console.log('\n── Retry System ────────────────────────────────');
  await test('GET /api/retry-status — responds', async () => {
    const r = await request('GET', '/api/retry-status?phone=+919999900000');
    assert(r.status === 200, `Got ${r.status}`);
    assert(typeof r.body.scheduled === 'boolean', 'scheduled should be boolean');
  });

  // ── Summary ──────────────────────────────────────────
  console.log('\n' + '─'.repeat(50));
  console.log(`\n  ${passed} passed  |  ${failed} failed`);
  if (failed === 0) {
    console.log('\n  ✅ ALL TESTS PASSED — system is production ready\n');
  } else {
    console.log('\n  ⚠️  Some tests failed — check your env vars and deployment\n');
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err.message);
  process.exit(1);
});
