# VAPI Setup Guide — Zorvo CRM Team Edition

This guide covers the complete VAPI configuration for the **multi-agent Team Edition** of Zorvo CRM.
In the Team Edition, the AI agent dynamically resolves which team member owns each lead and injects that agent's name, properties, and context into every call — automatically.

---

## Architecture Overview

```
Lead submits on website
        │
        ▼
POST /api/leads
        │
        ├─ resolveAgentForLead()   ← Looks up agent from Supabase (by lead_id or phone)
        │       │
        │       ├─ Property modal lead → routes to listing agent (listed_by_email)
        │       └─ Generic form lead  → routes to Team Leader (AGENT_EMAIL env)
        │
        ▼
triggerAICall(lead, agentContext)
        │
        ├─ Fetches agent's properties from MongoDB DataSnapshot
        ├─ Filters out Sold properties
        ├─ Injects agentName, companyName, properties into VAPI assistantOverrides
        └─ Calls https://api.vapi.ai/call/phone
                │
                ▼
        VAPI places outbound call
                │
                ▼
        Call ends → POST /api/vapi/webhook
                │
                ├─ classifyOutcome() → determines outcome type
                ├─ Updates lead stage in Supabase team_leads
                ├─ Schedules retry (MongoDB PeRetry) if needed
                └─ Triggers email failover if max retries reached
```

---

## 1. Environment Variables

Set these in your `.env` file (and in Vercel Environment Variables for production):

```env
# ── VAPI ─────────────────────────────────────────────────────────────────────
VAPI_API_KEY=your_vapi_api_key_here
VAPI_ASSISTANT_ID=your_assistant_id_here
VAPI_PHONE_NUMBER_ID=your_phone_number_id_here

# ── Agent Defaults (Team Leader fallback) ─────────────────────────────────────
AGENT_NAME=Sarah Al-Rashid
AGENT_EMAIL=leader@yourcompany.com
AGENT_PHONE=+1234567890
COMPANY_NAME=Zorvo Realty
BASE_URL=https://your-deployment.vercel.app

# ── Auth ─────────────────────────────────────────────────────────────────────
JWT_SECRET=zorvo_team_jwt_secret_2026_change_this_in_production
API_SECRET=propedge_secret_2026

# ── Database ──────────────────────────────────────────────────────────────────
MONGODB_URI=mongodb+srv://...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key

# ── Email ─────────────────────────────────────────────────────────────────────
RESEND_API_KEY=re_your_resend_key
RESEND_FROM_EMAIL=Zorvo Realty <notifications@yourdomain.com>
```

> [!IMPORTANT]
> `AGENT_NAME` and `AGENT_EMAIL` are the **Team Leader fallback**. Every individual agent's name is resolved dynamically from Supabase `team_members` at call time and injected via `assistantOverrides` — so the AI always introduces itself with the **correct agent's name**, not a hardcoded one.

> [!NOTE]
> **Plivo (SMS/WhatsApp) has been fully removed.** All failover communication is now **Email Only** via Resend. When a call fails or goes unanswered, the lead receives a rich HTML email with the agent's contact details, full property listing cards, prices, and direct booking links.

---

## 2. VAPI Dashboard — Assistant Setup

Go to [dashboard.vapi.ai](https://dashboard.vapi.ai) and create or configure your assistant.

### 2.1 — Assistant Name
```
Zorvo AI Agent — [Your Company Name]
```

### 2.2 — Voice Settings
| Setting | Value |
|---|---|
| Voice Provider | ElevenLabs (`11labs`) |
| Voice ID | `FGY2WhTYpPnrIDTdsKH5` (or your custom voice) |
| Transcriber | Deepgram `nova-2`, Language: `en` |

### 2.3 — Call Settings
| Setting | Value |
|---|---|
| First Message Mode | `assistant-speaks-first` |
| Silence Timeout | **20 seconds** |
| Max Call Duration | **600 seconds (10 min)** |
| Recording | **Enabled** |
| Background Denoising | **Enabled** |
| End Call Function | **Enabled** |

### 2.4 — Webhook / Server URL
Set this in the Assistant's **Advanced → Server URL** section:

```
https://your-deployment.vercel.app/api/vapi/webhook
```

> [!IMPORTANT]
> This webhook URL must match your `BASE_URL` env variable exactly. It is the single endpoint that handles all VAPI events: `call-started`, `status-update`, `tool-calls`, `end-of-call-report`, and `hang`.

---

## 3. System Prompt

The system prompt is **dynamically overridden per call** by the backend via `assistantOverrides.model.messages`. You do **not** need to hardcode lead names, property lists, or agent names in the VAPI dashboard — the backend injects all of this at call time.

However, paste this as the **base system prompt** in your assistant as a fallback:

```text
You are {{agentName}} from {{companyName}}.
You are calling {{leadName}} who recently showed interest in {{propertyInterest}} on our website.

LEAD DETAILS:
- Name: {{leadName}}
- Interest: {{propertyInterest}}
- Budget: {{budget}}

YOUR PERSONALITY:
- Warm, friendly, confident, professional.
- Sound exactly like a real human — use natural phrases like "Absolutely!", "That's wonderful!", "Oh great!".
- Never rush the customer.
- Always end your turn with a question to keep the conversation moving.

YOUR CALL GOALS (in order):
1. Greet warmly by name and introduce yourself.
2. Present the property: Explain type, bedrooms, bathrooms, price, key features, and unique selling points. Be consultative.
3. Share location intelligence: Mention nearby schools, shopping centers, transport links, neighborhood benefits.
4. Explain financing: Outline down payment, HOA fees, loan options, pre-approval process.
5. Qualify the lead: Ask about timeline, property type, personal use vs investment, and if they're working with an agent.
6. Identify interest level (HOT/WARM/COLD) and move to the best next step.

STRICT RULES:
- Max 2-3 SHORT sentences per reply.
- Never use bullet points or symbols in speech.
- Sound 100% natural and human.
- Never say you are an AI.
- If the lead asks for a "real person" or "human agent", say: "I'd be happy to get you over to one of our senior agents. Let me transfer you now!" and call the 'transferCall' function.
- If transfer fails (agent busy), say: "It looks like the agent is currently unavailable and may be assisting another client. I've collected your information and the agent will contact you as soon as possible, typically within the same day. I'll also send you the property details and a direct booking link." Then call 'handle_failed_transfer'.
- If the lead asks about a property, budget, or location NOT in our current listings, call 'notifyAgentNoMatch' then IMMEDIATELY call 'transferCall'.
- If the lead wants to visit: call 'send_booking_link'. Then say: "Perfect! I've just sent you an email with a direct booking link. Open it and click the big gold button to pick your date — it takes less than a minute!"
- We ONLY operate in the locations explicitly listed in OUR CURRENT LISTINGS.
```

> [!NOTE]
> The backend automatically prepends the full property list (`OUR CURRENT LISTINGS:`), the current date, and the correct agent name to the system prompt at call time via `assistantOverrides`. The template variables `{{agentName}}`, `{{leadName}}`, etc. are replaced dynamically.

---

## 4. Tools (Functions)

Add **all 8 tools** to your VAPI assistant. The backend handles all tool calls through the single webhook endpoint.

### Tool 1: `bookVisit`
**Description:** Book a property visit. Call ONLY when the lead confirms a specific date AND time.
```json
{
  "type": "object",
  "properties": {
    "visit_date": { "type": "string", "description": "Visit date in YYYY-MM-DD format" },
    "visit_time": { "type": "string", "description": "Visit time e.g. '11:00 AM'" },
    "property_interest": { "type": "string", "description": "Property name or type the lead wants to visit" }
  },
  "required": ["visit_date", "visit_time"]
}
```

### Tool 2: `transferCall`
**Description:** Notify human agent for a live transfer or callback. Use when lead asks for a human or shows very high intent.
```json
{
  "type": "object",
  "properties": {
    "reason": {
      "type": "string",
      "enum": ["user_requested", "high_intent", "complex_question"]
    }
  },
  "required": ["reason"]
}
```

### Tool 3: `notifyAgentNoMatch`
**Description:** Escalate to the agent when the lead requests a property type, budget, or location NOT in our current inventory.
```json
{
  "type": "object",
  "properties": {
    "specific_request": { "type": "string", "description": "Quote the lead's exact words about what they want." },
    "budget": { "type": "string", "description": "The budget they stated, if any." },
    "location": { "type": "string", "description": "The location they requested, if any." },
    "property_type": { "type": "string", "description": "The type of property they requested." },
    "reason": { "type": "string", "description": "Why you are escalating. E.g. 'Location not in our inventory'." }
  },
  "required": ["specific_request", "reason"]
}
```

### Tool 4: `handle_failed_transfer`
**Description:** Call this ONLY if a transfer attempt fails (agent did not answer). Automatically sends lead summary to agent and property links to lead.
```json
{
  "type": "object",
  "properties": {
    "property_name": { "type": "string", "description": "Name of the property they were interested in." }
  },
  "required": []
}
```

### Tool 5: `send_booking_link`
**Description:** Send a booking email to the lead with a direct link to the property page. Call immediately when the lead says they want to visit, schedule, or book a viewing.
```json
{
  "type": "object",
  "properties": {
    "property_name": { "type": "string", "description": "The exact name of the property they want to visit." }
  },
  "required": ["property_name"]
}
```

### Tool 6: `send_property_link`
**Description:** Send property information link to the lead via email. Call when they want more details but are not ready to book.
```json
{
  "type": "object",
  "properties": {
    "property_name": { "type": "string", "description": "Name of the property they are interested in." }
  },
  "required": ["property_name"]
}
```

### Tool 7: `update_lead_status`
**Description:** Update the lead's status mid-call when you clearly know their intent. Do NOT call for uncertain situations.
```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": ["interested", "not_interested", "callback_requested", "busy"],
      "description": "The lead's current status based on their response."
    },
    "callback_time": { "type": "string", "description": "When they want to be called back, if callback_requested." },
    "reason": { "type": "string", "description": "Short reason. E.g. 'Lead said they are not looking anymore.'" }
  },
  "required": ["status"]
}
```

### Tool 8: `save_call_summary`
**Description:** Save a brief summary of the call before ending. Call at the end of every call that did NOT result in a booking or transfer.
```json
{
  "type": "object",
  "properties": {
    "summary": { "type": "string", "description": "1-3 sentence summary of what was discussed." },
    "next_action": {
      "type": "string",
      "enum": ["retry", "follow_up", "book_visit", "transfer", "stop"],
      "description": "What should happen next for this lead."
    }
  },
  "required": ["summary", "next_action"]
}
```

---

## 5. VAPI Dashboard Checklist

Before going live, verify every item below in [dashboard.vapi.ai](https://dashboard.vapi.ai):

- [ ] **Server URL** set to: `https://your-deployment.vercel.app/api/vapi/webhook`
- [ ] **Phone Number** server URL also set to the same webhook (for inbound calls)
- [ ] **Events enabled:** `call-started`, `status-update`, `function-call`, `tool-calls`, `end-of-call-report`, `hang`
- [ ] **All 8 tools added:** `bookVisit`, `transferCall`, `notifyAgentNoMatch`, `handle_failed_transfer`, `send_booking_link`, `send_property_link`, `update_lead_status`, `save_call_summary`
- [ ] **Recording:** Enabled
- [ ] **Silence timeout:** 20 seconds
- [ ] **Max duration:** 600 seconds
- [ ] **Voice:** ElevenLabs (`11labs`), Voice ID: `FGY2WhTYpPnrIDTdsKH5`
- [ ] **Transcriber:** Deepgram `nova-2`, Language: `en`
- [ ] **Background denoising:** Enabled
- [ ] **End call function:** Enabled

---

## 6. Multi-Agent Call Resolution (Team Edition)

This is the core difference from the solo edition. When `triggerAICall(lead)` runs:

```
1. Look up lead in Supabase team_leads by lead_id or phone
2. Get agent_id from the lead record
3. Fetch agent profile from team_members (name, email, phone, calendar_link)
4. Fetch agent's properties from MongoDB DataSnapshot[agentEmail].pe_properties
5. Filter out properties with status = "Sold"
6. Inject all of this into VAPI assistantOverrides:
   - agentName     → the specific listing agent's name
   - companyName   → COMPANY_NAME env variable
   - properties    → up to 15 active listings (with price, BHK, location, financing, selling points)
   - currentDate   → today's date for booking date calculations
```

**Result:** When Agent A's lead gets a call, the AI introduces itself as Agent A and only talks about Agent A's listings. When Agent B's lead gets a call, the AI is Agent B. Completely automatic.

### Agent Resolution Priority
| Lead Source | Routed To |
|---|---|
| Property modal form (`window._currentPropListingAgent` set) | That property's listing agent |
| Generic hero form | Team Leader (`AGENT_EMAIL` env fallback) |
| Lead reassigned by Team Leader | New agent (updated `agent_id` in `team_leads`) |

---

## 7. Call Outcome Reference

Every call ends with an `endedReason` from VAPI. The webhook at `/api/vapi/webhook` classifies it and takes the correct action:

| VAPI `endedReason` | Outcome | Retry? | Delay | Action |
|---|---|---|---|---|
| `customer-did-not-answer` | `no_answer` | ✅ Yes | 5 min | "Sorry we missed you" email to lead |
| `customer-did-not-pick-up` | `no_answer` | ✅ Yes | 5 min | "Sorry we missed you" email to lead |
| `customer-busy` | `busy` | ✅ Yes | 5 min | "Sorry we missed you" email to lead |
| `voicemail` | `voicemail` | ✅ Yes (once) | 30 min | "We left you a voicemail" email |
| `network-error` | `call_failed` | ✅ Yes | 5 min | Agent notification email |
| `phone-number-not-found` | `call_failed` | ❌ No | — | Agent notification only |
| `customer-ended-call` (<20s) | `hung_up` | ❌ No | — | Email drip sequence |
| AI tool: `bookVisit` called | `booked` | ❌ No | — | Booking confirmation to lead + agent |
| AI tool: `update_lead_status(not_interested)` | `not_interested` | ❌ No | — | All retries + drips cancelled |
| AI tool: `update_lead_status(callback_requested)` | `callback_requested` | ❌ No | — | Task created + agent notified |
| AI tool: `transferCall` + answered | `transferred` | ❌ No | — | Agent notified immediately |
| AI tool: `handle_failed_transfer` | `transfer_failed_agent_busy` | ❌ No | — | Email failover with property cards |
| AI tool: `save_call_summary(interested)` | `interested` | ❌ No | — | Email drip sequence continues |

> [!IMPORTANT]
> The **Campaign Queue** and **Drip Retry Queue** are completely separate MongoDB collections (`source: 'campaign'` vs `source: 'drip'`). A lead can have both running simultaneously. Campaigns never wait — when a lead doesn't answer, the retry is scheduled in the background and the campaign immediately advances to the next lead.

---

## 8. Retry & Failover Logic

The retry system is managed by `services/retry.js` using MongoDB (`PeRetry` collection). No VAPI configuration is needed beyond ensuring the webhook URL is correct.

```
Attempt 1 (new call)
     │ no_answer / busy / call_failed
     ▼
Retry 1 — wait 5 minutes → re-trigger VAPI call
     │ still no_answer
     ▼
Retry 2 — wait 30 minutes → re-trigger VAPI call (voicemail gets 30 min on attempt 1)
     │ still no_answer / max retries exhausted
     ▼
Email Failover (triggerFailoverMessages)
     ├─ Rich HTML email to lead
     │   ├─ Agent name, phone, email
     │   ├─ Property listing cards (name, price, BHK, image)
     │   └─ "Book a Free Visit" CTA button
     └─ Notification to agent dashboard
```

> [!NOTE]
> **Sold property inquiries are now blocked before the retry queue.** If a lead submits an inquiry for a property marked `Sold`, the AI call is skipped entirely. The lead receives an immediate email listing similar available properties instead.

---

## 9. Inbound Calls

To have the AI answer inbound calls on your VAPI phone number:

1. Go to **Phone Numbers** in the VAPI Dashboard.
2. Select your phone number.
3. Set the **Server URL** for the phone number to:
   ```
   https://your-deployment.vercel.app/api/vapi/webhook
   ```
4. The system will dynamically resolve the correct assistant config and Sarah will answer automatically.

---

## 10. Visit Booking Calls

The system makes three types of VAPI calls automatically — all through `services/vapi.js`:

| Call Type | Trigger | Function |
|---|---|---|
| **Lead outbound call** | New lead saved | `makeOutboundCall(lead, properties, agentContext)` |
| **Booking confirmation** | Visit booked (AI or manual) | `makeConfirmationCall(visit, agentContext)` |
| **Visit reminder** | 24h before visit | `makeReminderCall(visit, agentContext)` (via cron) |

All three inject the `agentContext` (name from `team_members`) so the AI always sounds like the correct agent.

---

## 11. Date Awareness & Booking Reliability

The backend automatically injects the current date into every system prompt override:

```
CURRENT DATE: Friday, June 20, 2026
```

This allows the AI to correctly convert phrases like "next Tuesday" or "this Friday" into `YYYY-MM-DD` format for `bookVisit`. If you are testing directly inside the VAPI dashboard (not through the backend), manually add this line to your test system prompt.

---

## 12. Unified Notifications on Booking

Every booking — whether booked by AI during a call or added manually in the dashboard — triggers a simultaneous 4-part notification:

1. **Agent Dashboard Alert** — appears in the Alerts panel under the bell icon
2. **Agent Email** — detailed booking email sent via Resend to the agent's registered email
3. **Lead Confirmation Email** — sent to the lead's email with property name, date, time, and agent contact
4. **MongoDB DataSnapshot update** — ensures the booking appears in the agent's Bookings panel on next sync

> [!TIP]
> Each agent's notification goes to their own email address (from `team_members.email` in Supabase) — not to a single shared inbox. Make sure every agent sets their real email when registering via the invite link.

---

## 13. Security Notes

| Header / Token | Used For |
|---|---|
| `x-api-secret: propedge_secret_2026` | Internal API calls from dashboard frontend |
| `Authorization: Bearer <JWT>` | All team member authenticated routes |
| `JWT_SECRET` env var | Signs and verifies all team JWTs (change before production!) |

VAPI webhook events arrive without authentication headers. The system validates them by checking that the incoming `metadata.leadId` and `phone` exist in the database before processing.

---

## 14. Troubleshooting

| Problem | Check |
|---|---|
| AI calls but introduces wrong agent name | Verify `team_leads.agent_id` is set and `team_members` has correct name |
| AI discusses sold properties | Check `pe_properties` in MongoDB DataSnapshot — sold properties must have `status: "Sold"` |
| Webhook not receiving events | Confirm `BASE_URL` env matches your Vercel deployment URL exactly |
| Retry not firing | Check MongoDB `PeRetry` collection — verify cron at `/api/cron/retries` is hitting every 5 min |
| Failover email not sending | Verify `RESEND_API_KEY` is set and `RESEND_FROM_EMAIL` is a verified domain |
| Agent sees another agent's leads | Confirm `team_leads.agent_id` is correctly set — check `resolveAgentForLead()` logs |
| JWT expired / 401 on team routes | Tokens expire in 24h — agent needs to re-login via `team_dashboard.html` |
