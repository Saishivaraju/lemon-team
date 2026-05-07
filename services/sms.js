/**
 * services/sms.js — SMS Service (DISABLED)
 * ─────────────────────────────────────────────────────────────────────────────
 * SMS via Plivo has been removed.
 * All functions are kept as no-op stubs so no import errors occur.
 * Failover is now handled exclusively via Email (Resend).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const AGENT_NAME = process.env.AGENT_NAME || 'Sarah Al-Rashid';

async function sendSMSText(to, text) {
  console.log(`📵 [SMS DISABLED] Would have sent to ${to}: ${text?.substring(0, 60)}...`);
  return { success: false, disabled: true };
}

async function sendBookingConfirmedSMS(to, visit) {
  console.log(`📵 [SMS DISABLED] Booking confirmed SMS skipped for ${to}`);
  return { success: false, disabled: true };
}

async function sendVisitReminderSMS(to, visit) {
  console.log(`📵 [SMS DISABLED] Visit reminder SMS skipped for ${to}`);
  return { success: false, disabled: true };
}

async function sendCallFailoverSMS(to, name) {
  console.log(`📵 [SMS DISABLED] Failover SMS skipped for ${to}`);
  return { success: false, disabled: true };
}

module.exports = {
  sendSMSText,
  sendBookingConfirmedSMS,
  sendVisitReminderSMS,
  sendCallFailoverSMS
};
