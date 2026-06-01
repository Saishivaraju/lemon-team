// ─────────────────────────────────────────────────────────────────────────────
// services/retry.js — DB-backed Retry system for unanswered calls (Serverless-Safe)
// ─────────────────────────────────────────────────────────────────────────────
// Retry flow:
//   Attempt 1: retry after 5  min
//   Attempt 2: retry after 30 min
//   After max attempts: create follow-up task + notify agent + stop
//
// IMPORTANT: Campaign queue and retry queue are SEPARATE.
//   - Campaign retries use source = 'campaign'
//   - Email drip retries use source = 'drip'
//   - One phone number can have both a campaign AND a drip retry simultaneously.
// ─────────────────────────────────────────────────────────────────────────────

const mongoose = require('mongoose');

const MAX_RETRIES   = 2;
const RETRY_DELAYS  = [5 * 60 * 1000, 30 * 60 * 1000]; // 5 min, 30 min

// ── Schema ────────────────────────────────────────────────────────────────────
// NOTE: unique index on phone is REMOVED. One phone can have campaign + drip entries.
const RetrySchema = new mongoose.Schema({
  phone:      { type: String, required: true, index: true },
  source:     { type: String, enum: ['campaign', 'drip'], default: 'drip' },
  status:     { type: String, enum: ['pending', 'in_progress', 'exhausted'], default: 'pending' },
  attempts:   { type: Number, default: 0 },
  lead:       { type: Object, required: true },
  retryAt:    { type: Date, required: true },
  campaignId: { type: String, default: null },
}, { timestamps: true });

// Compound index: one retry record per (phone, source)
RetrySchema.index({ phone: 1, source: 1 }, { unique: true });

const PeRetry = mongoose.models.PeRetry || mongoose.model('PeRetry', RetrySchema);

// ── Internal: core scheduling logic ──────────────────────────────────────────
async function _scheduleRetry(lead, callFn, onFinalFailure, source = 'drip', campaignId = null, customDelayMs = null) {
  const phone = lead.phone;
  if (!phone) {
    console.warn('[RETRY] Skipped — lead has no phone number.');
    return;
  }

  const existing = await PeRetry.findOne({ phone, source });
  const attempt  = existing ? existing.attempts : 0;

  if (attempt >= MAX_RETRIES) {
    console.log(`[RETRY] ⛔ Max retries reached for ${phone} (source: ${source}). Triggering failover.`);
    if (onFinalFailure) {
      try { await onFinalFailure(lead); } catch (err) {
        console.error(`[RETRY] Failover error for ${phone}:`, err.message);
      }
    }
    await PeRetry.deleteOne({ phone, source });
    return;
  }

  // Use custom delay if provided (e.g. voicemail gets 30 min on first attempt),
  // otherwise fall back to the standard delay ladder.
  const delay    = customDelayMs !== null ? customDelayMs : (RETRY_DELAYS[attempt] || RETRY_DELAYS[RETRY_DELAYS.length - 1]);
  const minutes  = Math.round(delay / 60000);
  const retryAt  = new Date(Date.now() + delay);

  console.log(`[RETRY] 🔁 Scheduling retry ${attempt + 1}/${MAX_RETRIES} for ${phone} (source: ${source}) in ${minutes} minutes`);

  if (existing) {
    existing.attempts  = attempt + 1;
    existing.retryAt   = retryAt;
    existing.lead      = lead;
    existing.status    = 'pending';
    if (campaignId) existing.campaignId = campaignId;
    await existing.save();
  } else {
    await PeRetry.create({
      phone,
      source,
      attempts: attempt + 1,
      status: 'pending',
      lead,
      retryAt,
      campaignId,
    });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Schedule a retry for an email-drip / general lead call.
 */
async function scheduleRetry(lead, callFn, onFinalFailure, customDelayMs = null) {
  return _scheduleRetry(lead, callFn, onFinalFailure, 'drip', null, customDelayMs);
}

/**
 * Schedule a retry that originated from a campaign call.
 * These are completely separate from drip retries.
 */
async function scheduleRetryForCampaign(lead, callFn, onFinalFailure, campaignId = null, customDelayMs = null) {
  return _scheduleRetry(lead, callFn, onFinalFailure, 'campaign', campaignId, customDelayMs);
}

/**
 * Cancel ALL retries for a phone number (both campaign and drip).
 */
async function cancelRetry(phone) {
  if (!phone) return;
  const result = await PeRetry.deleteMany({ phone });
  if (result.deletedCount > 0) {
    console.log(`[RETRY] ✅ Cancelled ${result.deletedCount} retry record(s) for ${phone}`);
  }
}

/**
 * Cancel only drip retries for a phone number.
 */
async function cancelDripRetry(phone) {
  if (!phone) return;
  const result = await PeRetry.deleteMany({ phone, source: 'drip' });
  if (result.deletedCount > 0) {
    console.log(`[RETRY] ✅ Cancelled drip retry for ${phone}`);
  }
}

/**
 * Get retry status for a phone number.
 */
async function getRetryStatus(phone) {
  if (!phone) return { scheduled: false, attempts: 0 };
  const entries = await PeRetry.find({ phone });
  if (!entries.length) return { scheduled: false, attempts: 0 };
  return {
    scheduled: true,
    attempts:  entries.reduce((sum, e) => sum + e.attempts, 0),
    records:   entries.map(e => ({ source: e.source, attempts: e.attempts, retryAt: e.retryAt, status: e.status })),
  };
}

/**
 * Process all pending retry calls whose retry time has arrived.
 * This is called by the /api/cron/retries endpoint every ~5 minutes.
 *
 * @param {Function} callFn         - async (lead) => { success, callId, ... }
 * @param {Function} onFinalFailure - async (lead) => void — called when max retries exhausted
 */
async function processPendingRetries(callFn, onFinalFailure) {
  const now     = new Date();
  const pending = await PeRetry.find({ retryAt: { $lte: now }, status: 'pending' });

  if (pending.length === 0) {
    console.log('[RETRY] No pending retries at this time.');
    return;
  }

  console.log(`[RETRY] ⏰ Found ${pending.length} pending retry record(s) to process...`);

  for (const entry of pending) {
    const { lead, phone, attempts, source } = entry;
    console.log(`[RETRY] 📞 Executing retry attempt ${attempts}/${MAX_RETRIES} for ${phone} (source: ${source})`);

    // Mark as in_progress immediately to prevent double-firing if cron overlaps
    entry.status  = 'in_progress';
    entry.retryAt = new Date(Date.now() + 10 * 60 * 1000); // safety buffer: 10 min
    await entry.save();

    try {
      const result = await callFn(lead);

      if (result?.success) {
        console.log(`[RETRY] ✅ Call dispatched for ${phone}. Outcome will arrive via webhook.`);
        // Leave status as 'in_progress'. The webhook will call scheduleRetry again if still no answer,
        // which will increment attempts. If answered, cancelRetry() will clean up the record.
      } else {
        console.log(`[RETRY] ❌ VAPI trigger failed for ${phone}: ${result?.error || 'Unknown error'}. Rescheduling.`);
        // Put back to pending so next cron run can try again
        entry.status  = 'pending';
        entry.retryAt = new Date(Date.now() + 5 * 60 * 1000);
        await entry.save();
      }
    } catch (err) {
      console.error(`[RETRY] Error during retry execution for ${phone}:`, err.message);
      entry.status  = 'pending';
      entry.retryAt = new Date(Date.now() + 5 * 60 * 1000);
      await entry.save();
    }
  }
}

module.exports = {
  scheduleRetry,
  scheduleRetryForCampaign,
  cancelRetry,
  cancelDripRetry,
  getRetryStatus,
  processPendingRetries,
};
