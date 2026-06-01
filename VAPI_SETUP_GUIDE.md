# Vapi Assistant Setup Guide

To ensure your Vapi AI agent can correctly book visits and transfer calls, you should configure your assistant in the [Vapi Dashboard](https://dashboard.vapi.ai) with the following settings.

## 1. System Prompt
Copy and paste this into the "System Prompt" section of your assistant:

```text
You are Sarah Al-Rashid, a friendly and expert real estate agent at Zorvo Realty.

You are on a LIVE PHONE CALL with a potential property buyer who just submitted a lead on our website.

YOUR PERSONALITY:
- Warm, friendly, confident, professional.
- Sound exactly like a real human — use natural phrases like "Absolutely!", "That's wonderful!", "Oh great!".
- Never rush the customer.
- Always end your turn with a question to keep the conversation moving.

YOUR CALL GOALS (in order):
1. Greet warmly: "Hi [Lead Name]! This is Sarah from Zorvo Realty. I saw you were interested in [Property Name]. How are you today?"
2. Confirm interest: Ask if they are still looking for properties in that area.
3. Qualifying: Ask about their budget and preferred move-in timeline.
4. Book a Visit: If they sound interested, offer to book an on-site visit. Ask: "Would you like to come see the property this week? I have slots on Thursday morning or Friday afternoon."
5. Confirm Visit: Once they pick a date and time, call the 'bookVisit' function.
6. Transfer: If they ask for a "real person", "human agent", or have a complex question you can't answer, say: "I'd be happy to get you over to one of our senior agents. Let me transfer you now!" then call the 'transferCall' function.

STRICT RULES:
- Max 2-3 SHORT sentences per reply.
- Never say you are an AI.
- If they say they are busy, ask: "No problem! Should I try you back tomorrow morning or evening?"
- We ONLY have properties in the locations explicitly mentioned in OUR CURRENT LISTINGS. If a lead asks for properties in another country, city, or area we do not cover, politely inform them that we currently only operate in our listed areas.
- If the lead's budget or location does not match ANY of our current listings, say "We don't have a property in that budget or area right now, but I will send your information to our senior agent. He will check the market and inform you within 5 hours." and IMMEDIATELY call the notifyAgentNoMatch function.
```

## 2. Tools (Functions)
Add these two tools to your assistant configuration.

### tool: bookVisit
*   **Type:** Function (Custom Tool)
*   **Description:** Book a property visit. Call ONLY when lead confirms a specific date AND time.
*   **Parameters (JSON Schema):**
```json
{
  "type": "object",
  "properties": {
    "visit_date": { "type": "string", "description": "Visit date in YYYY-MM-DD format" },
    "visit_time": { "type": "string", "description": "Visit time e.g. \"11:00 AM\"" },
    "property_interest": { "type": "string", "description": "Property name or type" }
  },
  "required": ["visit_date", "visit_time"]
}
```

### tool: transferCall
*   **Type:** Function (Custom Tool)
*   **Description:** Notify human agent to call back. Use when lead asks for human or shows very high intent.
*   **Parameters (JSON Schema):**
```json
{
  "type": "object",
  "properties": {
    "reason": { "type": "string", "enum": ["user_requested", "high_intent", "complex_question"] }
  },
  "required": ["reason"]
}
```

### tool: notifyAgentNoMatch
*   **Type:** Function (Custom Tool)
*   **Description:** Notify the human agent when a lead requests a budget or location we do not currently have in inventory.
*   **Parameters (JSON Schema):**
```json
{
  "type": "object",
  "properties": {
    "budget": { "type": "string", "description": "The budget the lead requested" },
    "location": { "type": "string", "description": "The location the lead requested" },
    "property_type": { "type": "string", "description": "The type of property requested" }
  },
  "required": ["budget", "location"]
}
```

### tool: sendSMS
This allows Sarah to send the lead property details via SMS *during* the call.
*   **Type:** Function (Custom Tool)
*   **Description:** Send a text message (SMS) to the lead with property details.
*   **Server URL:** `https://scaleover-lemon.vercel.app/api/ai/sms`
*   **Parameters (JSON Schema):**
```json
{
  "type": "object",
  "properties": {
    "phone": { "type": "string", "description": "The lead's phone number" },
    "message": { "type": "string", "description": "The SMS content to send" }
  },
  "required": ["phone", "message"]
}
```

### tool: update_lead_status *(NEW)*
*   **Type:** Function (Custom Tool)
*   **Description:** Update the lead status mid-call when you know if they are interested, not interested, or want a callback.
*   **Server URL:** `https://scaleover-lemon.vercel.app/api/vapi/webhook`
*   **Parameters (JSON Schema):**
```json
{
  "type": "object",
  "properties": {
    "status": { "type": "string", "enum": ["interested", "not_interested", "callback_requested", "busy"] },
    "callback_time": { "type": "string", "description": "When they want to be called back (if callback_requested)" },
    "reason": { "type": "string", "description": "Short reason for this status" }
  },
  "required": ["status"]
}
```

### tool: create_follow_up *(NEW)*
*   **Type:** Function (Custom Tool)
*   **Description:** Create a manual follow-up task for the agent when a lead needs personal attention.
*   **Server URL:** `https://scaleover-lemon.vercel.app/api/vapi/webhook`
*   **Parameters (JSON Schema):**
```json
{
  "type": "object",
  "properties": {
    "reason": { "type": "string", "description": "Why the follow-up is needed" },
    "due_in_hours": { "type": "number", "description": "Hours from now when follow-up is due. Default 24." }
  },
  "required": ["reason"]
}
```

### tool: save_call_summary *(NEW)*
*   **Type:** Function (Custom Tool)
*   **Description:** Save a brief summary of the call before ending it. Call this before ending any call that did not result in a booking or transfer.
*   **Server URL:** `https://scaleover-lemon.vercel.app/api/vapi/webhook`
*   **Parameters (JSON Schema):**
```json
{
  "type": "object",
  "properties": {
    "summary": { "type": "string", "description": "1-3 sentence summary of the call" },
    "next_action": { "type": "string", "enum": ["retry", "follow_up", "book_visit", "transfer", "stop"] }
  },
  "required": ["summary", "next_action"]
}
```

## 3. Webhook URL (Critical for Retries)
The webhook is how Vapi tells our system if a call was answered, missed, or if a visit was booked.

1.  Set your **Server URL** in the Assistant's "Advanced" section to:
    `https://scaleover-lemon.vercel.app/api/vapi/webhook`
2.  Ensure **all event messages** are enabled (specifically `call.status-update` and `end-of-call-report`).

### VAPI Dashboard Checklist
- [ ] Server URL: `https://scaleover-lemon.vercel.app/api/vapi/webhook`
- [ ] Events enabled: `call-started`, `status-update`, `function-call`, `tool-calls`, `end-of-call-report`, `hang`
- [ ] Tools added: `bookVisit`, `transferCall`, `notifyAgentNoMatch`, `update_lead_status`, `create_follow_up`, `save_call_summary`, `sendSMS`
- [ ] Recording enabled: **YES**
- [ ] Silence timeout: **20s**
- [ ] Max duration: **600s**

## 4. Call Outcome Reference Table

Every call ends with a `endedReason` from VAPI. Here is how the system handles each:

| VAPI `endedReason` | Outcome Status | Retry? | Delay | Action |
|---|---|---|---|---|
| `customer-did-not-answer` | `no_answer` | ✅ Yes | 5 min | "Sorry we missed you" email |
| `customer-did-not-pick-up` | `no_answer` | ✅ Yes | 5 min | "Sorry we missed you" email |
| `customer-busy` | `busy` | ✅ Yes | 5 min | "Sorry we missed you" email |
| `voicemail` | `voicemail` | ✅ Yes | 30 min | "We left you a voicemail" email |
| `network-error` | `call_failed` | ✅ Yes | 5 min | Agent notification |
| `phone-number-not-found` | `call_failed` | ❌ No | — | Agent notification only |
| `customer-ended-call` (< 20s) | `hung_up` | ❌ No | — | Drip email sequence |
| `assistant-ended-call` + booked | `booked` | ❌ No | — | Booking confirmation email |
| `assistant-ended-call` + not interested | `not_interested` | ❌ No | — | All retries cancelled |
| `assistant-ended-call` + callback | `callback_requested` | ❌ No | — | Task created + agent notified |
| `assistant-ended-call` + transfer | `transferred` | ❌ No | — | Agent notified immediately |
| `assistant-ended-call` (general) | `interested` | ❌ No | — | Drip email sequence |

> [!IMPORTANT]
> The **Campaign Queue** and **Retry Queue** are completely separate. When a lead doesn't answer during a campaign, the system schedules a retry in a separate queue and **immediately advances to the next lead**. The campaign never waits.

## 5. Smart Retry & Failover Logic
Our system is configured to handle missed calls automatically with a three-stage escalation:

1.  **Stage 1 (Retry 1)**: If the first call is missed, the system waits **5 minutes** and retries.
2.  **Stage 2 (Retry 2)**: If still no answer, it waits **30 minutes** and retries a final time.
3.  **Stage 3 (Omnichannel Failover)**: If all 3 attempts fail, the system automatically sends:
    *   **WhatsApp Message** (Reviewing property listings).
    *   **SMS** (Missed call notification).
    *   **Email** (Professional follow-up).

> [!NOTE]
> This logic is managed entirely by the backend `services/retry.js` and does not require additional configuration in Vapi other than ensuring the Webhook URL is correct.

## 6. Inbound Calls
To make the AI pick up calls when someone calls your Vapi number:
1. Go to **Phone Numbers** in the Vapi Dashboard.
2. Select your phone number.
3. Set the **Server URL** for the phone number to the same webhook: `https://scaleover-lemon.vercel.app/api/vapi/webhook`.
4. Now, when a call comes in, the system will provide the assistant config dynamically, and Sarah will answer automatically.

## 7. Date Awareness & Booking Reliability
The system is now configured with **Date Awareness**. This means the AI knows the current date and can convert relative phrases like "next Tuesday" into the `YYYY-MM-DD` format required for bookings.

- **Automated**: The backend code automatically injects the current date into the system prompt.
- **Manual Testing**: If you are testing the assistant directly in the Vapi Dashboard, you should manually add a line like `CURRENT DATE: Friday, May 15, 2026` to the system prompt to help the AI calculate dates correctly during tests.

## 8. Unified Notifications
Every successful booking via Vapi now triggers a unified notification sequence:
- **Agent Dashboard Alert**: A notification appears under the bell icon in your dashboard.
- **Agent Email**: A detailed email is sent to your registered address.
- **Client Email**: A confirmation email is sent to the lead.

> [!TIP]
> Ensure your `AGENT_EMAIL` in the `.env` file is correct, as this is where all booking alerts will be sent.

## 9. AI Data Normalization & Transfers
With the latest update, there are **NO changes required to your System Prompt** to fix spoken dates, times, emails, or phone numbers.

Here is what you need to ensure in the Vapi Dashboard:
1. **Server URL**: Double-check that your Assistant's Server URL is set to `https://scaleover-lemon.vercel.app/api/vapi/webhook`. This webhook automatically catches any spoken words (like "nine eight seven" or "john dot smith") and converts them into proper digits and formats before saving them to your dashboard.
2. **Transfer Calls**: The `transferCall` function works automatically through the webhook. Do not hardcode a phone number inside the Vapi dashboard. Instead, ensure you have set the `TRANSFER_NUMBER` or `AGENT_PHONE` in your server's `.env` file (e.g. `TRANSFER_NUMBER=+1234567890`). The webhook will normalize this number and securely pass it to Vapi during the call.

The webhook is how Vapi tells our system if a call was answered, missed, or if a visit was booked.

1.  Set your **Server URL** in the Assistant's "Advanced" section to:
    `https://scaleover-lemon.vercel.app/api/vapi/webhook`
2.  Ensure **all event messages** are enabled (specifically `call.status-update` and `end-of-call-report`).
