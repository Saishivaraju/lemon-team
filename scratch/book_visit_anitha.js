require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { sendEmail } = require('../services/email');

const AGENT_EMAIL = process.env.AGENT_EMAIL || 'saishivaraju.m2002@gmail.com';
const AGENT_NAME  = process.env.AGENT_NAME  || 'Sarah Al-Rashid';
const BASE_URL    = process.env.BASE_URL    || 'https://scaleover-lemon.vercel.app';

const visit = {
  client_name:   'Anitha',
  client_email:  'anitha.m1117@gmail.com',
  client_phone:  '+919900744658',
  property_name: 'Skyview Residences',
  property_address: 'Downtown, Dubai',
  visit_date:    '2026-05-06',
  visit_time:    '11:00',
  status:        'confirmed'
};

async function run() {
  console.log('\n📅 Booking visit for', visit.client_email, '...\n');

  // 1. Client confirmation email
  const clientRes = await sendEmail({
    to: visit.client_email,
    subject: `✅ Visit Confirmed: ${visit.property_name}`,
    html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0e14;border-radius:12px;overflow:hidden;border:1px solid #c5a059">
  <div style="background:linear-gradient(135deg,#1a1a18,#0f2044);padding:28px 32px;border-bottom:2px solid #c5a059">
    <h1 style="margin:0;color:#c5a059;font-size:22px;font-weight:300;letter-spacing:2px">🏡 BOOKING CONFIRMED</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.45);font-size:13px">Zorvo Real Estate</p>
  </div>
  <div style="padding:28px 32px">
    <p style="color:#faf8f4;font-size:16px;margin:0 0 20px">Dear <strong>${visit.client_name}</strong>,</p>
    <p style="color:rgba(255,255,255,0.65);font-size:14px;line-height:1.7;margin:0 0 24px">
      Your exclusive property viewing has been successfully scheduled. We look forward to showing you this exceptional property.
    </p>
    <div style="background:rgba(197,160,89,0.06);border:1px solid rgba(197,160,89,0.25);border-radius:8px;padding:20px;margin-bottom:24px">
      <h3 style="margin:0 0 14px;color:#c5a059;font-size:13px;text-transform:uppercase;letter-spacing:1px">Visit Details</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 0;color:rgba(255,255,255,0.45);width:130px">🏠 Property</td><td style="padding:6px 0;color:#faf8f4"><strong>${visit.property_name}</strong></td></tr>
        <tr><td style="padding:6px 0;color:rgba(255,255,255,0.45)">📍 Address</td><td style="padding:6px 0;color:#faf8f4">${visit.property_address}</td></tr>
        <tr><td style="padding:6px 0;color:rgba(255,255,255,0.45)">🗓 Date</td><td style="padding:6px 0;color:#faf8f4">${visit.visit_date}</td></tr>
        <tr><td style="padding:6px 0;color:rgba(255,255,255,0.45)">⏰ Time</td><td style="padding:6px 0;color:#2ecc8a;font-weight:600">${visit.visit_time}</td></tr>
        <tr><td style="padding:6px 0;color:rgba(255,255,255,0.45)">✅ Status</td><td style="padding:6px 0;color:#2ecc8a;font-weight:600">Confirmed</td></tr>
      </table>
    </div>
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:20px;margin-bottom:24px">
      <h3 style="margin:0 0 14px;color:#c5a059;font-size:13px;text-transform:uppercase;letter-spacing:1px">Your Agent</h3>
      <p style="margin:4px 0;color:#faf8f4;font-size:15px"><strong>${AGENT_NAME}</strong></p>
      <p style="margin:4px 0;color:rgba(255,255,255,0.5);font-size:13px">📞 ${process.env.AGENT_PHONE || '+971 50 123 4567'}</p>
      <p style="margin:4px 0;color:rgba(255,255,255,0.5);font-size:13px">✉️ ${AGENT_EMAIL}</p>
    </div>
    <div style="text-align:center">
      <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(visit.property_address)}"
         style="display:inline-block;background:#c5a059;color:#0a0e14;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;letter-spacing:1px">
        📍 VIEW ON GOOGLE MAPS
      </a>
    </div>
    <p style="margin:24px 0 0;font-size:11px;color:rgba(255,255,255,0.2);text-align:center">Powered by Zorvo Agency Nerve Center</p>
  </div>
</div>`,
    message: `Hi ${visit.client_name}, your visit to ${visit.property_name} is confirmed for ${visit.visit_date} at ${visit.visit_time}. Agent: ${AGENT_NAME} (${AGENT_EMAIL})`
  });

  // 2. Agent alert email
  const agentRes = await sendEmail({
    to: AGENT_EMAIL,
    subject: `🛎️ New Visit Booked — ${visit.client_name} → ${visit.property_name}`,
    html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0e14;border-radius:12px;overflow:hidden;border:1px solid #c5a059">
  <div style="background:linear-gradient(135deg,#1a1a18,#0f2044);padding:28px 32px;border-bottom:2px solid #c5a059">
    <h1 style="margin:0;color:#c5a059;font-size:22px;font-weight:300;letter-spacing:2px">🛎️ NEW VISIT BOOKED</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.45);font-size:13px">Zorvo Agency Nerve Center</p>
  </div>
  <div style="padding:28px 32px">
    <div style="background:rgba(197,160,89,0.06);border:1px solid rgba(197,160,89,0.2);border-radius:8px;padding:20px;margin-bottom:20px">
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 0;color:rgba(255,255,255,0.45);width:130px">👤 Client</td><td style="padding:6px 0;color:#faf8f4"><strong>${visit.client_name}</strong></td></tr>
        <tr><td style="padding:6px 0;color:rgba(255,255,255,0.45)">📞 Phone</td><td style="padding:6px 0;color:#faf8f4">${visit.client_phone}</td></tr>
        <tr><td style="padding:6px 0;color:rgba(255,255,255,0.45)">✉️ Email</td><td style="padding:6px 0;color:#faf8f4">${visit.client_email}</td></tr>
        <tr><td style="padding:6px 0;color:rgba(255,255,255,0.45)">🏠 Property</td><td style="padding:6px 0;color:#faf8f4">${visit.property_name}</td></tr>
        <tr><td style="padding:6px 0;color:rgba(255,255,255,0.45)">🗓 Date</td><td style="padding:6px 0;color:#faf8f4">${visit.visit_date}</td></tr>
        <tr><td style="padding:6px 0;color:rgba(255,255,255,0.45)">⏰ Time</td><td style="padding:6px 0;color:#2ecc8a;font-weight:600">${visit.visit_time}</td></tr>
      </table>
    </div>
    <div style="text-align:center">
      <a href="${BASE_URL}" style="display:inline-block;background:#c5a059;color:#0a0e14;padding:13px 32px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;letter-spacing:1px">OPEN DASHBOARD →</a>
    </div>
  </div>
</div>`,
    message: `New visit: ${visit.client_name} booked ${visit.property_name} for ${visit.visit_date} at ${visit.visit_time}.`
  });

  console.log('📬 Client confirmation →', clientRes.success ? '✅ sent to ' + visit.client_email : '❌ ' + clientRes.error);
  console.log('🔔 Agent alert        →', agentRes.success  ? '✅ sent to ' + AGENT_EMAIL         : '❌ ' + agentRes.error);
}

run().catch(e => console.error('❌', e.message));

