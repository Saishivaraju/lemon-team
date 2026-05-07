// ─────────────────────────────────────────────────────────────────────────────
// services/retry.js — Retry system for unanswered calls
// If a lead does not answer → retry after 5 min → retry again after 15 min
// Max 3 attempts per lead
// ─────────────────────────────────────────────────────────────────────────────

const MAX_RETRIES   = 2;
const RETRY_DELAYS  = [5 * 60 * 1000, 30 * 60 * 1000]; // 5m, 30m

/** In-memory retry queue */
const retryQueue = new Map(); // phone → { attempts, lead, timerId }

/**
 * Schedule a retry call for a lead that did not answer.
 * @param {object} lead             - Full lead object { name, phone, ... }
 * @param {Function} callFn         - async function(lead) → triggers the actual call
 * @param {Function} onFinalFailure - optional function(lead) → called when all retries fail
 */
function scheduleRetry(lead, callFn, onFinalFailure) {
  const phone    = lead.phone;
  const existing = retryQueue.get(phone) || { attempts: 0, lead };
  const attempt  = existing.attempts;

  if (attempt >= MAX_RETRIES) {
    console.log(`⛔ Max retries reached for ${phone}. Triggering failover.`);
    if (onFinalFailure) onFinalFailure(lead);
    retryQueue.delete(phone);
    return;
  }

  const delay = RETRY_DELAYS[attempt];
  const minutes = Math.round(delay / 60000);

  console.log(`🔁 Scheduling retry ${attempt + 1}/${MAX_RETRIES} for ${phone} in ${minutes} minutes`);

  if (existing.timerId) clearTimeout(existing.timerId);

  const timerId = setTimeout(async () => {
    console.log(`📞 Retry attempt ${attempt + 1} for ${phone}`);
    try {
      const result = await callFn(lead);
      if (result?.answered) {
        console.log(`✅ Lead ${phone} answered on retry ${attempt + 1}`);
        retryQueue.delete(phone);
      } else {
        retryQueue.set(phone, { attempts: attempt + 1, lead, timerId: null });
        scheduleRetry(lead, callFn, onFinalFailure);
      }
    } catch (err) {
      console.error(`Retry call error for ${phone}:`, err.message);
      retryQueue.set(phone, { attempts: attempt + 1, lead, timerId: null });
      scheduleRetry(lead, callFn, onFinalFailure);
    }
  }, delay);

  retryQueue.set(phone, { attempts: attempt + 1, lead, timerId });
}

/**
 * Cancel retries for a lead (e.g. they answered or booked).
 */
function cancelRetry(phone) {
  const entry = retryQueue.get(phone);
  if (entry?.timerId) clearTimeout(entry.timerId);
  retryQueue.delete(phone);
  console.log(`✅ Cancelled retries for ${phone}`);
}

/**
 * Get retry status for a phone number.
 */
function getRetryStatus(phone) {
  const entry = retryQueue.get(phone);
  return entry ? { scheduled: true, attempts: entry.attempts } : { scheduled: false, attempts: 0 };
}

module.exports = { scheduleRetry, cancelRetry, getRetryStatus };
