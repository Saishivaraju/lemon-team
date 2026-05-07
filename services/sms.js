/**
 * services/sms.js — Zorvo SMS Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Sends SMS messages via a bridge or standard API.
 * 
 * Default: Simulation mode (logs to console)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const AGENT_NAME = process.env.AGENT_NAME || 'Sarah Al-Rashid';
const COMPANY_NAME = process.env.COMPANY_NAME || 'Zorvo Realty';

/**
 * Normalize phone to digits only
 */
function normalizePhone(phone) {
  if (!phone) return null;
  return String(phone).replace(/\D/g, '');
}

/**
 * Core send — can be updated to use Twilio, MessageBird, or a local bridge
 */
async function sendSMSText(to, text) {
  const phone = normalizePhone(to);
  if (!phone) {
    console.warn(`⚠️  SMS: Invalid phone "${to}"`);
    return { success: false, error: 'Invalid phone number' };
  }

  // SIMULATION MODE
  console.log(`📠 [SMS-SIMULATION] To: +${phone}\n${text}\n`);
  
  // Example of how you'd call a bridge if you had one:
  /*
  try {
    const { default: fetch } = await import('node-fetch');
    const res = await fetch(`${process.env.SMS_BRIDGE_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: phone, message: text })
    });
    return await res.json();
  } catch (err) {
    return { success: false, error: err.message };
  }
  */

  return { success: true, simulated: true };
}

// ── MESSAGE TEMPLATES ─────────────────────────────────────────────────────────

async function sendBookingConfirmedSMS(to, visit) {
  const msg = `Hi ${visit.client_name}, your visit to ${visit.property_name} is CONFIRMED for ${visit.visit_date} at ${visit.visit_time}. See you soon! — ${AGENT_NAME}`;
  return sendSMSText(to, msg);
}

async function sendVisitReminderSMS(to, visit) {
  const msg = `Reminder: Your property visit for ${visit.property_name} is scheduled for tomorrow at ${visit.visit_time}. — ${AGENT_NAME}`;
  return sendSMSText(to, msg);
}

async function sendCallFailoverSMS(to, name) {
  const msg = `Hi ${name || 'there'}, I just tried calling you regarding your property inquiry but couldn't connect. I've sent you more details on WhatsApp and Email. — ${AGENT_NAME}`;
  return sendSMSText(to, msg);
}

module.exports = {
  sendSMSText,
  sendBookingConfirmedSMS,
  sendVisitReminderSMS,
  sendCallFailoverSMS
};
