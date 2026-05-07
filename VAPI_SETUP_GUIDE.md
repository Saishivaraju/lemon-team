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
```

## 2. Tools (Functions)
Add these two tools to your assistant configuration.

### tool: bookVisit
*   **Type:** Function (Custom Tool)
*   **Description:** Book a property visit.
*   **Parameters (JSON Schema):**
```json
{
  "type": "object",
  "properties": {
    "visit_date": { "type": "string", "description": "YYYY-MM-DD" },
    "visit_time": { "type": "string", "description": "e.g. 11:00 AM" },
    "property_interest": { "type": "string" }
  },
  "required": ["visit_date", "visit_time"]
}
```

### tool: transferCall
*   **Type:** Function (Custom Tool)
*   **Description:** Transfer the call to a live agent.
*   **Parameters (JSON Schema):**
```json
{
  "type": "object",
  "properties": {
    "reason": { "type": "string", "enum": ["user_requested", "complex_question", "high_intent"] }
  },
  "required": ["reason"]
}
```

### tool: sendSMS
This allows Sarah to send the lead property details via SMS *during* the call.
*   **Type:** Function (Custom Tool)
*   **Description:** Send a text message (SMS) to the lead with property details.
*   **Server URL:** `https://anizorvo.vercel.app/api/ai/sms`
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

## 3. Webhook URL (Critical for Retries)
The webhook is how Vapi tells our system if a call was answered, missed, or if a visit was booked.

1.  Set your **Server URL** in the Assistant's "Advanced" section to:
    `https://anizorvo.vercel.app/api/vapi/webhook`
2.  Ensure **all event messages** are enabled (specifically `call.status-update` and `end-of-call-report`).

## 4. Smart Retry & Failover Logic
Our system is configured to handle missed calls automatically with a three-stage escalation:

1.  **Stage 1 (Retry 1)**: If the first call is missed, the system waits **5 minutes** and retries.
2.  **Stage 2 (Retry 2)**: If still no answer, it waits **30 minutes** and retries a final time.
3.  **Stage 3 (Omnichannel Failover)**: If all 3 attempts fail, the system automatically sends:
    *   **WhatsApp Message** (Reviewing property listings).
    *   **SMS** (Missed call notification).
    *   **Email** (Professional follow-up).

> [!NOTE]
> This logic is managed entirely by the backend `services/retry.js` and does not require additional configuration in Vapi other than ensuring the Webhook URL is correct.

## 5. Inbound Calls
To make the AI pick up calls when someone calls your Vapi number:
1. Go to **Phone Numbers** in the Vapi Dashboard.
2. Select your phone number.
3. Set the **Server URL** for the phone number to the same webhook: `https://anizorvo.vercel.app/api/vapi/webhook`.
4. Now, when a call comes in, the system will provide the assistant config dynamically, and Sarah will answer automatically.
