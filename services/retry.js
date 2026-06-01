// ─────────────────────────────────────────────────────────────────────────────
// services/retry.js — DB-backed Retry system for unanswered calls (Serverless-Safe)
// If a lead does not answer → retry after 5 min → retry again after 30 min
// Max 3 attempts per lead
// ─────────────────────────────────────────────────────────────────────────────

const mongoose = require('mongoose');

const MAX_RETRIES   = 2;
const RETRY_DELAYS  = [5 * 60 * 1000, 30 * 60 * 1000]; // 5m, 30m

const RetrySchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  attempts: { type: Number, default: 0 },
  lead: { type: Object, required: true },
  retryAt: { type: Date, required: true }
}, { timestamps: true });

const PeRetry = mongoose.models.PeRetry || mongoose.model('PeRetry', RetrySchema);

/**
 * Schedule a retry call for a lead that did not answer.
 * @param {object} lead             - Full lead object { name, phone, ... }
 * @param {Function} callFn         - async function(lead) → triggers the actual call
 * @param {Function} onFinalFailure - optional function(lead) → called when all retries fail
 */
async function scheduleRetry(lead, callFn, onFinalFailure) {
  const phone = lead.phone;
  if (!phone) return;

  const existing = await PeRetry.findOne({ phone });
  const attempt = existing ? existing.attempts : 0;

  if (attempt >= MAX_RETRIES) {
    console.log(`⛔ Max retries reached for ${phone}. Triggering failover.`);
    if (onFinalFailure) {
      try {
        await onFinalFailure(lead);
      } catch (err) {
        console.error(`Failover error for ${phone}:`, err.message);
      }
    }
    await PeRetry.deleteOne({ phone });
    return;
  }

  const delay = RETRY_DELAYS[attempt];
  const minutes = Math.round(delay / 60000);
  const retryAt = new Date(Date.now() + delay);

  console.log(`🔁 Scheduling retry ${attempt + 1}/${MAX_RETRIES} for ${phone} in ${minutes} minutes`);

  if (existing) {
    existing.attempts = attempt + 1;
    existing.retryAt = retryAt;
    existing.lead = lead;
    await existing.save();
  } else {
    const newRetry = new PeRetry({
      phone,
      attempts: attempt + 1,
      lead,
      retryAt
    });
    await newRetry.save();
  }


}

/**
 * Cancel retries for a lead (e.g. they answered or booked).
 */
async function cancelRetry(phone) {
  if (!phone) return;
  const result = await PeRetry.deleteOne({ phone });
  if (result.deletedCount > 0) {
    console.log(`✅ Cancelled retries for ${phone}`);
  }
}

/**
 * Get retry status for a phone number.
 */
async function getRetryStatus(phone) {
  if (!phone) return { scheduled: false, attempts: 0 };
  const entry = await PeRetry.findOne({ phone });
  return entry ? { scheduled: true, attempts: entry.attempts } : { scheduled: false, attempts: 0 };
}

/**
 * Process all pending calls whose retry time has arrived.
 */
async function processPendingRetries(callFn, onFinalFailure) {
  const now = new Date();
  const pending = await PeRetry.find({ retryAt: { $lte: now } });
  
  if (pending.length === 0) {
    return;
  }
  
  console.log(`⏰ Found ${pending.length} pending calls to retry...`);
  
  for (const entry of pending) {
    const lead = entry.lead;
    const phone = entry.phone;
    const attempt = entry.attempts;
    
    console.log(`📞 Executing retry attempt ${attempt}/${MAX_RETRIES} for ${phone}`);
    
    try {
      const result = await callFn(lead);
      
      if (result?.answered) {
        console.log(`✅ Lead ${phone} answered on retry attempt ${attempt}`);
        await PeRetry.deleteOne({ phone });
      } else if (result?.success) {
        console.log(`📞 Call dispatched successfully for ${phone}. Waiting for call outcome webhook...`);
        // Push retry time forward by 10 minutes as a safety buffer so it doesn't double-trigger during call
        entry.retryAt = new Date(Date.now() + 10 * 60 * 1000);
        await entry.save();
      } else {
        console.log(`❌ VAPI call failed to trigger for ${phone}: ${result?.error || 'Unknown trigger error'}`);
        await scheduleRetry(lead, callFn, onFinalFailure);
      }
    } catch (err) {
      console.error(`Error during retry execution for ${phone}:`, err.message);
      await scheduleRetry(lead, callFn, onFinalFailure);
    }
  }
}

module.exports = {
  scheduleRetry,
  cancelRetry,
  getRetryStatus,
  processPendingRetries
};
