/**
 * services/whatsapp.js — WhatsApp Service (DISABLED)
 * ─────────────────────────────────────────────────────────────────────────────
 * WhatsApp via Plivo / bridge has been removed.
 * All functions are kept as no-op stubs so no import errors occur.
 * Failover is now handled exclusively via Email (Resend).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const AGENT_NAME = process.env.AGENT_NAME || 'Sarah Al-Rashid';
const VERCEL_URL  = process.env.BASE_URL   || 'https://scaleover-lemon.vercel.app';

function normalizePhone(phone) {
  if (!phone) return null;
  let p = String(phone).replace(/[\s\-().]/g, '');
  if (p.startsWith('00')) p = p.slice(2);
  if (p.startsWith('+'))  p = p.slice(1);
  if (/^[1-9]\d{6,14}$/.test(p)) return p;
  return null;
}

async function sendWhatsAppText(to, text) {
  const phone = normalizePhone(to);
  console.log(`📵 [WhatsApp DISABLED] Would have sent to +${phone || to}: ${text?.substring(0, 60)}...`);
  return { success: false, disabled: true };
}

async function sendBookingCreatedMsg(clientPhone, visit) {
  console.log(`📵 [WhatsApp DISABLED] Booking created WA skipped for ${clientPhone}`);
  return { success: false, disabled: true };
}

async function sendBookingConfirmedMsg(clientPhone, visit) {
  console.log(`📵 [WhatsApp DISABLED] Booking confirmed WA skipped for ${clientPhone}`);
  return { success: false, disabled: true };
}

async function sendVisitReminderMsg(clientPhone, visit) {
  console.log(`📵 [WhatsApp DISABLED] Visit reminder WA skipped for ${clientPhone}`);
  return { success: false, disabled: true };
}

async function sendNewLeadNotification(agentPhone, lead) {
  console.log(`📵 [WhatsApp DISABLED] New lead WA notification skipped for ${agentPhone}`);
  return { success: false, disabled: true };
}

async function sendAICallLink(clientPhone, lead) {
  console.log(`📵 [WhatsApp DISABLED] AI call link WA skipped for ${clientPhone}`);
  return { success: false, disabled: true };
}

module.exports = {
  sendWhatsAppText,
  sendBookingCreatedMsg,
  sendBookingConfirmedMsg,
  sendVisitReminderMsg,
  sendNewLeadNotification,
  sendAICallLink,
};
