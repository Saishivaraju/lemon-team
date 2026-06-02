// ─────────────────────────────────────────────────────────────────────────────
// services/callOutcome.js — Call Outcome Classification & Structured Results
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for:
//   1. Mapping VAPI endedReason → normalized status
//   2. Determining retry policy per outcome
//   3. Building the structured CallResult JSON after every call
// ─────────────────────────────────────────────────────────────────────────────

// ── Outcome status constants ──────────────────────────────────────────────────
const OUTCOMES = {
  NO_ANSWER:          'no_answer',
  HUNG_UP:            'hung_up',
  BUSY:               'busy',
  VOICEMAIL:          'voicemail',
  CALL_FAILED:        'call_failed',
  INTERESTED:         'interested',
  NOT_INTERESTED:     'not_interested',
  CALLBACK_REQUESTED: 'callback_requested',
  BOOKED:             'booked',
  TRANSFERRED:        'transferred',
  TRANSFER_FAILED_AGENT_BUSY: 'transfer_failed_agent_busy',
};

// ── VAPI endedReason → base outcome (before AI intent override) ───────────────
const ENDED_REASON_MAP = {
  'customer-did-not-answer':      OUTCOMES.NO_ANSWER,
  'customer-did-not-pick-up':     OUTCOMES.NO_ANSWER,
  'customer-busy':                OUTCOMES.BUSY,
  'voicemail':                    OUTCOMES.VOICEMAIL,
  'network-error':                OUTCOMES.CALL_FAILED,
  'phone-number-not-found':       OUTCOMES.CALL_FAILED,
  'assistant-error':              OUTCOMES.CALL_FAILED,
  'pipeline-error':               OUTCOMES.CALL_FAILED,
  'silence-timed-out':            OUTCOMES.NO_ANSWER,
  'max-duration-exceeded':        OUTCOMES.INTERESTED,   // long call = some engagement
  'customer-ended-call':          OUTCOMES.HUNG_UP,
  'assistant-ended-call':         OUTCOMES.INTERESTED,   // refined by AI intent below
  'call-start-error-telephony-provider-busy': OUTCOMES.BUSY,
  'call-start-error-no-server-available':     OUTCOMES.CALL_FAILED,
};

// ── Retry policy per outcome ──────────────────────────────────────────────────
// Returns { shouldRetry, retryDelayMinutes, retryDelayMinutes2, isRetryable }
const RETRY_POLICY = {
  [OUTCOMES.NO_ANSWER]:          { shouldRetry: true,  retryDelayMinutes: 5,  finalRetryDelayMinutes: 30, maxAttempts: 2 },
  [OUTCOMES.BUSY]:               { shouldRetry: true,  retryDelayMinutes: 5,  finalRetryDelayMinutes: 30, maxAttempts: 2 },
  [OUTCOMES.VOICEMAIL]:          { shouldRetry: true,  retryDelayMinutes: 30, finalRetryDelayMinutes: 30, maxAttempts: 1 },
  [OUTCOMES.HUNG_UP]:            { shouldRetry: false, retryDelayMinutes: 30, finalRetryDelayMinutes: 30, maxAttempts: 1 },
  [OUTCOMES.CALL_FAILED]:        { shouldRetry: true,  retryDelayMinutes: 5,  finalRetryDelayMinutes: 5,  maxAttempts: 1 },
  [OUTCOMES.INTERESTED]:         { shouldRetry: false, retryDelayMinutes: 0,  finalRetryDelayMinutes: 0,  maxAttempts: 0 },
  [OUTCOMES.NOT_INTERESTED]:     { shouldRetry: false, retryDelayMinutes: 0,  finalRetryDelayMinutes: 0,  maxAttempts: 0 },
  [OUTCOMES.CALLBACK_REQUESTED]: { shouldRetry: false, retryDelayMinutes: 0,  finalRetryDelayMinutes: 0,  maxAttempts: 0 },
  [OUTCOMES.BOOKED]:             { shouldRetry: false, retryDelayMinutes: 0,  finalRetryDelayMinutes: 0,  maxAttempts: 0 },
  [OUTCOMES.TRANSFERRED]:        { shouldRetry: false, retryDelayMinutes: 0,  finalRetryDelayMinutes: 0,  maxAttempts: 0 },
  [OUTCOMES.TRANSFER_FAILED_AGENT_BUSY]: { shouldRetry: false, retryDelayMinutes: 0,  finalRetryDelayMinutes: 0,  maxAttempts: 0 },
};

// ── Phone-number-not-found should never be retried ────────────────────────────
const NON_RETRYABLE_REASONS = new Set([
  'phone-number-not-found',
  'assistant-error',
  'pipeline-error',
]);

/**
 * Classify the call outcome from VAPI event data + AI intelligence.
 *
 * @param {string}  endedReason    - VAPI endedReason string
 * @param {number}  duration       - Call duration in seconds
 * @param {object}  aiIntelligence - Result from analyzeTranscript()
 * @param {boolean} bookingCreated - Whether a bookVisit tool call succeeded
 * @param {boolean} transferDone   - Whether a transferCall tool call succeeded
 * @param {boolean} callbackSet    - Whether update_lead_status was called with callback_requested
 * @returns {string} One of the OUTCOMES constants
 */
function classifyOutcome(endedReason, duration, aiIntelligence = {}, bookingCreated = false, transferDone = false, callbackSet = false) {
  // Explicit tool-call results take highest priority
  if (bookingCreated)  return OUTCOMES.BOOKED;
  if (transferDone)    return OUTCOMES.TRANSFERRED;
  if (callbackSet)     return OUTCOMES.CALLBACK_REQUESTED;

  // Very short calls with failed reason = hard fail
  if (duration < 8 && endedReason && endedReason !== 'assistant-ended-call' && endedReason !== 'customer-ended-call') {
    return ENDED_REASON_MAP[endedReason] || OUTCOMES.NO_ANSWER;
  }

  // Map endedReason
  const baseOutcome = ENDED_REASON_MAP[endedReason] || OUTCOMES.INTERESTED;

  // For completed calls, refine using AI intent
  if (baseOutcome === OUTCOMES.INTERESTED || baseOutcome === OUTCOMES.HUNG_UP) {
    const intent    = (aiIntelligence.outcome || aiIntelligence.intent || '').toUpperCase();
    const score     = aiIntelligence.closing_probability || aiIntelligence.lead_score_num || 0;

    if (intent.includes('NOT_INTERESTED') || intent.includes('NOT INTERESTED'))  return OUTCOMES.NOT_INTERESTED;
    if (intent.includes('BOOKED') || intent.includes('BOOK'))                    return OUTCOMES.BOOKED;
    if (intent.includes('CALLBACK') || intent.includes('CALL BACK'))             return OUTCOMES.CALLBACK_REQUESTED;
    if (intent.includes('TRANSFER'))                                             return OUTCOMES.TRANSFERRED;

    // If duration was very short and call ended by customer → hung up
    if (duration < 20 && endedReason === 'customer-ended-call') return OUTCOMES.HUNG_UP;

    // Default for a real answered call
    return score > 0 ? OUTCOMES.INTERESTED : baseOutcome;
  }

  return baseOutcome;
}

/**
 * Get retry policy for a given outcome status.
 * @param {string} status - One of the OUTCOMES constants
 * @param {string} endedReason - Original VAPI endedReason (to handle non-retryable cases)
 * @returns {{ shouldRetry: boolean, retryDelayMinutes: number, maxAttempts: number }}
 */
function getRetryPolicy(status, endedReason = '') {
  const policy = RETRY_POLICY[status] || { shouldRetry: false, retryDelayMinutes: 0, maxAttempts: 0 };

  // Override: never retry if the phone number is invalid
  if (NON_RETRYABLE_REASONS.has(endedReason)) {
    return { ...policy, shouldRetry: false };
  }

  return policy;
}

/**
 * Build the full structured CallResult JSON required after every call.
 *
 * @param {object} params
 * @returns {object} CallResult
 */
function buildCallResult({
  leadId,
  callId,
  status,
  endedReason,
  transcript,
  aiIntelligence = {},
  duration = 0,
  retryScheduled = false,
  retryTimeMinutes = 0,
  bookingCreated = false,
  transferRequired = false,
  followUpRequired = false,
  callbackTime = null,
}) {
  const leadScore  = aiIntelligence.lead_score  || 'WARM';
  const priority   = aiIntelligence.priority    || 'FOLLOW_UP';
  const intent     = aiIntelligence.intent      || 'unknown';
  const budget     = aiIntelligence.extracted_budget_numeric || null;
  const timeline   = aiIntelligence.timeline    || null;
  const objections = aiIntelligence.objections  || [];
  const summary    = aiIntelligence.call_summary || buildDefaultSummary(status, duration);

  // Determine next_action from status
  const nextActionMap = {
    [OUTCOMES.NO_ANSWER]:          'retry',
    [OUTCOMES.BUSY]:               'retry',
    [OUTCOMES.VOICEMAIL]:          'retry',
    [OUTCOMES.HUNG_UP]:            'follow_up',
    [OUTCOMES.CALL_FAILED]:        retryScheduled ? 'retry' : 'stop',
    [OUTCOMES.INTERESTED]:         'follow_up',
    [OUTCOMES.NOT_INTERESTED]:     'stop',
    [OUTCOMES.CALLBACK_REQUESTED]: 'follow_up',
    [OUTCOMES.BOOKED]:             'book_visit',
    [OUTCOMES.TRANSFERRED]:        'transfer',
    [OUTCOMES.TRANSFER_FAILED_AGENT_BUSY]: 'follow_up',
  };

  return {
    lead_id:              leadId   || null,
    call_id:              callId   || null,
    status,
    reason:               buildReason(status, endedReason, duration),
    transcript:           transcript || '',
    summary,
    lead_score:           leadScore,
    priority,
    intent,
    budget,
    timeline,
    callback_time:        callbackTime,
    objections,
    next_action:          nextActionMap[status] || 'follow_up',
    retry_scheduled:      retryScheduled,
    retry_time_minutes:   retryTimeMinutes,
    follow_up_required:   followUpRequired,
    booking_created:      bookingCreated,
    transfer_required:    transferRequired,
    duration_seconds:     duration,
    created_at:           new Date().toISOString(),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildDefaultSummary(status, duration) {
  const d = Math.round(duration);
  switch (status) {
    case OUTCOMES.NO_ANSWER:          return `Lead did not answer the call (${d}s).`;
    case OUTCOMES.BUSY:               return `Lead's line was busy (${d}s).`;
    case OUTCOMES.VOICEMAIL:          return `Call went to voicemail (${d}s).`;
    case OUTCOMES.HUNG_UP:            return `Lead hung up after ${d} seconds.`;
    case OUTCOMES.CALL_FAILED:        return `Call failed to connect (${d}s).`;
    case OUTCOMES.INTERESTED:         return `Lead engaged with the call (${d}s) — follow-up recommended.`;
    case OUTCOMES.NOT_INTERESTED:     return `Lead confirmed they are not interested.`;
    case OUTCOMES.CALLBACK_REQUESTED: return `Lead requested a callback at a later time.`;
    case OUTCOMES.BOOKED:             return `Lead confirmed a property visit booking.`;
    case OUTCOMES.TRANSFERRED:        return `Call transferred to human agent.`;
    default:                          return `Call ended after ${d} seconds.`;
  }
}

function buildReason(status, endedReason, duration) {
  if (endedReason) return `VAPI ended reason: ${endedReason}`;
  return buildDefaultSummary(status, duration);
}

// ── Lead score label from score number ───────────────────────────────────────
function scoreToBucket(score) {
  if (score >= 80) return 'HOT';
  if (score >= 50) return 'WARM';
  return 'COLD';
}

// ── Human-readable duration string ───────────────────────────────────────────
function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

module.exports = {
  OUTCOMES,
  ENDED_REASON_MAP,
  RETRY_POLICY,
  classifyOutcome,
  getRetryPolicy,
  buildCallResult,
  buildDefaultSummary,
  formatDuration,
  scoreToBucket,
};
