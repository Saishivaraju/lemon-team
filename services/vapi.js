// ─────────────────────────────────────────────────────────────────────────────
// services/vapi.js — VAPI AI Calling Service
// ─────────────────────────────────────────────────────────────────────────────
// VAPI handles everything: outbound call, voice, STT, AI, TTS
// We just tell it who to call and what assistant to use.
// Sign up free at: dashboard.vapi.ai
// ─────────────────────────────────────────────────────────────────────────────

const VAPI_API_KEY         = process.env.VAPI_API_KEY;
const VAPI_ASSISTANT_ID    = process.env.VAPI_ASSISTANT_ID;
const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID;
const AGENT_NAME           = process.env.AGENT_NAME    || 'Sarah Al-Rashid';
const COMPANY_NAME         = process.env.COMPANY_NAME  || 'Zorvo Realty';
const BASE_URL             = process.env.BASE_URL       || 'https://lemon-mocha.vercel.app';

// ── Make outbound call via VAPI ───────────────────────────────────────────────
async function makeOutboundCall(lead, properties = [], agentContext = null) {
  if (!VAPI_API_KEY) {
    console.warn('⚠️  VAPI_API_KEY not set — simulating call');
    return { success: true, simulated: true, id: 'sim_' + Date.now() };
  }

  const { default: fetch } = await import('node-fetch');
  const agentName = agentContext?.name || lead.assigned_agent_name || AGENT_NAME;

  // Format property list for the AI
  const propertyList = properties.length > 0
    ? properties.slice(0, 15).map((p, i) =>
        `${i+1}. ${p.name || p.title}
   - Type: ${p.property_type || p.emoji || 'Property'}
   - Location: ${p.address || p.location || 'N/A'}
   - Price: ${p.price_label || (p.price ? '$' + Number(p.price).toLocaleString() : 'Contact agent')}
   - Features: ${p.bedrooms ? p.bedrooms + ' BR' : ''} ${p.bathrooms ? '· ' + p.bathrooms + ' BA' : ''}
   - Description: ${p.description ? p.description.substring(0, 100) + '...' : 'Premium property.'}
   - Neighborhood Info: ${p.neighborhood_info || 'N/A'}
   - Financing Options: ${p.financing_options || 'N/A'}
   - Key Selling Points: ${p.key_selling_points || 'N/A'}`
      ).join('\n\n')
    : 'Properties will be loaded dynamically from our latest inventory.';

  // Build dynamic assistant override with lead context and property knowledge
  const assistantOverrides = {
    variableValues: {
      leadName:         lead.name              || 'there',
      propertyInterest: lead.property_interest || 'properties',
      budget:           lead.budget            || 'flexible',
      agentName:        agentName,
      companyName:      COMPANY_NAME,
    },
    model: {
      provider: 'openai',
      model:    'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are ${agentName} from ${COMPANY_NAME}.
You are calling ${lead.name || 'a lead'} who recently showed interest in ${lead.property_interest || 'real estate'} on our website.

LEAD DETAILS:
- Name: ${lead.name || 'Valued Client'}
- Interest: ${lead.property_interest || 'General Real Estate'}
- Budget: ${lead.budget || 'Flexible'}

OUR CURRENT LISTINGS:
${propertyList}

YOUR GOAL:
1. Greet them by name and introduce yourself naturally.
2. Present the property: Explain type, bedrooms, bathrooms, price, key features, and unique selling points. Be consultative, not robotic.
3. Share location intelligence: Mention nearby schools, shopping centers, companies, transport, and other neighborhood benefits.
4. Explain financing: Outline purchasing terms, down payment, HOA fees, loan options, and how they can get pre-approved or apply for loans.
5. Qualify the lead: Ask if they are actively searching, what type of property they are interested in, their timeline, if it's for personal use or investment, and if they are already working with an agent.
6. Identify their interest level (HOT, WARM, COLD) and move them to the best next step.
   - Do NOT force a booking.
   - You can offer to send property details or a booking link via SMS/email.
   - If they show strong interest, offer to transfer the call directly to a senior agent right now.`
        }
      ]
    },
    firstMessage: `Hi, this is an automated assistant calling on behalf of ${agentName} regarding a property that may match your interests. Is this a good time to chat?`,
  };

  const body = {
    assistantId:      VAPI_ASSISTANT_ID,
    assistantOverrides,
    phoneNumberId:    VAPI_PHONE_NUMBER_ID,
    customer: {
      number: lead.phone,
      name:   lead.name || 'Lead',
    },
    metadata: {
      leadId:   lead.id       || null,
      agentId:  lead.agent_id || lead.agent_email || null,
      teamId:   lead.team_id  || null,
      phone:    lead.phone,
      email:    lead.email    || null,
      interest: lead.property_interest || null,
      budget:   lead.budget   || null,
    },
  };

  try {
    const res = await fetch('https://api.vapi.ai/call/phone', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('❌ VAPI API Error:', data);
      const errorMsg = data.message || (data.error && data.error.message) || 'VAPI authorization failed. Check your VAPI_API_KEY.';
      return { success: false, error: errorMsg };
    }

    console.log(`📞 VAPI call started → ID: ${data.id} for ${lead.name} (${lead.phone})`);
    return { success: true, callId: data.id, answered: false, data };

  } catch (err) {
    console.error('❌ VAPI request failed:', err.message);
    return { success: false, error: err.message };
  }
}
// ── Make outbound confirmation call via VAPI ────────────────────────────────────
async function makeConfirmationCall(visit, agentContext = null) {
  if (!VAPI_API_KEY) return { success: true, simulated: true };
  const { default: fetch } = await import('node-fetch');
  const agentName = agentContext?.name || AGENT_NAME;

  const body = {
    assistantId:   VAPI_ASSISTANT_ID,
    assistantOverrides: {
      firstMessage: `Hi ${visit.client_name || 'there'}! This is ${agentName} from ${COMPANY_NAME}. I am calling to confirm your property visit booking for ${visit.property_name || 'our property'}. I see you booked it for ${visit.visit_date} at ${visit.visit_time}. We are very excited to show you the property! Do you need directions or have any questions about the location?`,
      variableValues: { isConfirmation: 'true', propertyName: visit.property_name },
    },
    phoneNumberId: VAPI_PHONE_NUMBER_ID,
    customer: {
      number: visit.client_phone,
      name:   visit.client_name || 'Client',
    },
  };

  try {
    const res  = await fetch('https://api.vapi.ai/call/phone', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${VAPI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return { success: res.ok, callId: data.id };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Make outbound reminder call via VAPI ──────────────────────────────────────
async function makeReminderCall(visit, agentContext = null) {
  if (!VAPI_API_KEY) return { success: true, simulated: true };
  const { default: fetch } = await import('node-fetch');
  const agentName = agentContext?.name || AGENT_NAME;

  const body = {
    assistantId:   VAPI_ASSISTANT_ID,
    assistantOverrides: {
      firstMessage: `Hi ${visit.client_name || 'there'}! This is ${agentName} from ${COMPANY_NAME}. Just a friendly reminder that your property visit for ${visit.property_name || 'our property'} is scheduled for tomorrow at ${visit.visit_time || 'the confirmed time'}. We are looking forward to seeing you! Do you have any questions before then?`,
      variableValues: { isReminder: 'true', propertyName: visit.property_name },
    },
    phoneNumberId: VAPI_PHONE_NUMBER_ID,
    customer: {
      number: visit.client_phone,
      name:   visit.client_name || 'Client',
    },
  };

  try {
    const res  = await fetch('https://api.vapi.ai/call/phone', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${VAPI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return { success: res.ok, callId: data.id };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Get call details from VAPI ────────────────────────────────────────────────
async function getCall(callId) {
  if (!VAPI_API_KEY || !callId) return null;
  const { default: fetch } = await import('node-fetch');
  try {
    const res  = await fetch(`https://api.vapi.ai/call/${callId}`, {
      headers: { 'Authorization': `Bearer ${VAPI_API_KEY}` },
    });
    return await res.json();
  } catch (e) { return null; }
}

// ── List recent calls ─────────────────────────────────────────────────────────
async function listCalls(limit = 20) {
  if (!VAPI_API_KEY) return [];
  const { default: fetch } = await import('node-fetch');
  try {
    const res  = await fetch(`https://api.vapi.ai/call?limit=${limit}`, {
      headers: { 'Authorization': `Bearer ${VAPI_API_KEY}` },
    });
    const data = await res.json();
    return Array.isArray(data) ? data : data.results || [];
  } catch (e) { return []; }
}

// ── Build assistant config (call once to create your assistant) ───────────────
function buildAssistantConfig(properties = [], agentContext = null) {
  const agentName = agentContext?.name || AGENT_NAME;
  const companyName = COMPANY_NAME;
  const propertyList = properties.length > 0
    ? properties.slice(0, 15).map((p, i) =>
        `${i+1}. ${p.name || p.title}
   - Type: ${p.property_type || p.emoji || 'Property'}
   - Location: ${p.address || p.location || 'N/A'}
   - Price: ${p.price_label || (p.price ? '$' + Number(p.price).toLocaleString() : 'Contact agent')}
   - Features: ${p.bedrooms ? p.bedrooms + ' BR' : ''} ${p.bathrooms ? '· ' + p.bathrooms + ' BA' : ''}
   - Description: ${p.description ? p.description.substring(0, 100) + '...' : 'Premium property.'}
   - Neighborhood Info: ${p.neighborhood_info || 'N/A'}
   - Financing Options: ${p.financing_options || 'N/A'}
   - Key Selling Points: ${p.key_selling_points || 'N/A'}`
      ).join('\n\n')
    : 'Properties will be loaded dynamically from our latest inventory.';

  return {
    name: `${agentName} — ${companyName}`,
    firstMessageMode: 'assistant-speaks-first',
    model: {
      provider: 'openai',
      model:    'gpt-4o-mini',
      messages: [
        {
          role:    'system',
          content: `You are ${agentName}, a friendly and expert real estate agent at ${companyName}.
You are answering a call from a lead who might be interested in our properties.

OUR CURRENT LISTINGS:
${propertyList}

YOUR PERSONALITY:
- Warm, friendly, confident, professional
- Sound exactly like a real human — not a robot
- Use natural phrases: "Absolutely!", "That is wonderful!", "Oh great!", "I totally understand"
- Be genuinely excited about helping them find their home
- Never rush the customer
- Always end your turn with a question to keep conversation going

YOUR CALL GOALS:
1. Greet them warmly and introduce the property.
2. Present the property: Explain type, bedrooms, bathrooms, price, key features, and unique selling points. Be consultative, not robotic.
3. Share location intelligence: Mention nearby schools, shopping centers, companies, transport, and other neighborhood benefits.
4. Explain financing: Outline purchasing terms, down payment, HOA fees, loan options, and how they can get pre-approved or apply for loans.
5. Qualify the lead: Ask about their timeline, property type, if for personal use or investment, and if they are actively searching.
6. Identify their interest level (HOT, WARM, COLD) and move them to the next best step.
   - Do NOT force an appointment booking. Do not keep asking for dates and times unless the lead explicitly requests a visit.
   - If they are HOT (strong interest): Offer to transfer to the agent right now, or send a property link / visit booking link.
   - If they are WARM: Offer to send property information and follow up.
   - If they are COLD: Store the result for future nurture.
   - Offer to send a booking page link if they want to visit. Booking is optional, not mandatory.

YOUR RULES:
- Max 2-3 SHORT sentences per reply.
- Never use bullet points or symbols in speech.
- Sound 100% natural and human.
- If the lead shows strong interest and accepts a transfer, IMMEDIATELY call the transferCall function.
- If a transfer attempt fails (the system tells you the agent is busy or unavailable), you MUST say exactly: "It looks like the agent is currently unavailable and may be assisting another client or showing a property. I've already collected your information and will make sure the agent receives everything discussed today. The agent will contact you as soon as possible, typically within the same day. In the meantime, I'll also send you the property details and a direct booking link. If you'd like, you can schedule a property visit online at your convenience." AND you MUST immediately call the handle_failed_transfer function.
- If the lead asks a question you don't know the answer to, OR they request a property type/location/budget NOT in OUR CURRENT LISTINGS: (1) First call notifyAgentNoMatch with their specific_request (quote their exact words), the budget, location, property_type, and your reason for escalating. (2) Then IMMEDIATELY call transferCall with reason "complex_question". Do NOT say you will follow up later — transfer them live RIGHT NOW. Say: "That's a very specific requirement — let me connect you directly with our senior agent who can help you with this right now. Please hold just a moment."
- If the lead says they want to visit, schedule a visit, or book an appointment, call the send_booking_link function with the property_name they mentioned. After calling it, say exactly: "Perfect! I've just sent you an email with a direct booking link. Simply open the email, click the big gold button that says Book My Visit Now, and you can pick your preferred date and time instantly. It takes less than a minute!"
- If the lead wants property details only (no visit), call the send_property_link function.
- We ONLY have properties in the locations explicitly mentioned in OUR CURRENT LISTINGS.`
        }
      ],
      functions: [
        {
          name:        'handle_failed_transfer',
          description: 'Call this function ONLY if a transfer attempt fails (e.g. agent did not answer) to automatically send the lead summary to the agent, send the links to the lead, and schedule a same-day follow-up.',
          parameters: {
            type: 'object',
            properties: {
              property_name: { type: 'string', description: 'Name of the property they were interested in.' }
            },
            required: [],
          },
        },
        {
          name:        'send_property_link',
          description: 'Send the property information link to the lead via SMS/email. Call this when they want more details about a property.',
          parameters: {
            type: 'object',
            properties: {
              property_name: { type: 'string', description: 'Name of the property they are interested in.' }
            },
            required: ['property_name'],
          },
        },
        {
          name:        'send_booking_link',
          description: 'Send a beautiful booking email to the lead with a direct link to the specific property page where they can book a visit. Call this IMMEDIATELY when the lead says they want to visit, schedule, or book a viewing.',
          parameters: {
            type: 'object',
            properties: {
              property_name: { type: 'string', description: 'The exact name of the property they want to visit. Required so the email links directly to that property page.' }
            },
            required: ['property_name'],
          },
        },
        {
          name:        'bookVisit',
          description: 'Book a property visit. Call ONLY when lead confirms a specific date AND time.',
          parameters: {
            type: 'object',
            properties: {
              visit_date:        { type: 'string', description: 'Visit date in YYYY-MM-DD format' },
              visit_time:        { type: 'string', description: 'Visit time e.g. "11:00 AM"' },
              property_interest: { type: 'string', description: 'Property name or type' },
            },
            required: ['visit_date', 'visit_time'],
          },
        },
        {
          name:        'transferCall',
          description: 'Notify human agent to call back. Use when lead asks for human or shows very high intent.',
          parameters: {
            type: 'object',
            properties: {
              reason: { type: 'string', enum: ['user_requested', 'high_intent', 'complex_question'] },
            },
            required: ['reason'],
          },
        },
        {
          name:        'notifyAgentNoMatch',
          description: 'Call this when: (1) a lead asks about something you cannot answer, (2) they request a property type, location, or budget NOT in our inventory, (3) they have a very specific or unusual requirement you cannot fulfil. After calling this, IMMEDIATELY call transferCall.',
          parameters: {
            type: 'object',
            properties: {
              specific_request: { type: 'string', description: 'Quote the lead\'s exact words about what they want. Example: "I need a 4-bedroom villa in Malibu with a pool under $800K".' },
              budget:           { type: 'string', description: 'The budget they stated, if any.' },
              location:         { type: 'string', description: 'The location they requested, if any.' },
              property_type:    { type: 'string', description: 'The type of property they requested.' },
              reason:           { type: 'string', description: 'Why you are escalating. Example: "Location not in our inventory" or "I don\'t know the answer to their financing question".' }
            },
            required: ['specific_request', 'reason'],
          },
        },
        {
          name:        'update_lead_status',
          description: 'Update the lead status mid-call. Call when you clearly know if the lead is interested, not interested, or wants a callback. Do NOT call for uncertain situations.',
          parameters: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['interested', 'not_interested', 'callback_requested', 'busy'],
                description: 'The lead\'s current status based on their response.'
              },
              callback_time: {
                type: 'string',
                description: 'If status is callback_requested: when they want to be called back. Example: "tomorrow at 3pm".'
              },
              reason: {
                type: 'string',
                description: 'Short human-readable reason. Example: "Lead said they are not looking anymore."'
              }
            },
            required: ['status'],
          },
        },
        {
          name:        'create_follow_up',
          description: 'Create a follow-up task for the agent. Use when a lead requests a manual callback or needs personal attention that you cannot handle.',
          parameters: {
            type: 'object',
            properties: {
              reason: {
                type: 'string',
                description: 'Why the follow-up is needed. Example: "Lead wants to discuss financing options with a senior agent."'
              },
              due_in_hours: {
                type: 'number',
                description: 'How many hours from now the follow-up should happen. Default 24.'
              }
            },
            required: ['reason'],
          },
        },
        {
          name:        'save_call_summary',
          description: 'Save a brief summary of the call before ending it. Call this at the end of every call that did not result in a booking or transfer.',
          parameters: {
            type: 'object',
            properties: {
              summary: {
                type: 'string',
                description: 'A 1-3 sentence summary of what was discussed and the lead\'s current situation.'
              },
              next_action: {
                type: 'string',
                enum: ['retry', 'follow_up', 'book_visit', 'transfer', 'stop'],
                description: 'What should happen next for this lead.'
              }
            },
            required: ['summary', 'next_action'],
          },
        },
      ],
    },
    voice: {
      provider: '11labs',
      voiceId:  process.env.ELEVENLABS_VOICE_ID || 'FGY2WhTYpPnrIDTdsKH5',
    },
    transcriber: {
      provider: 'deepgram',
      model:    'nova-2',
      language: 'en',
    },
    serverUrl: `${BASE_URL}/api/vapi/webhook`,
    endCallFunctionEnabled:    true,
    recordingEnabled:          true,
    silenceTimeoutSeconds:     20,
    maxDurationSeconds:        600,
    backgroundDenoisingEnabled: true,
  };
}

module.exports = {
  makeConfirmationCall,
  makeOutboundCall,
  makeReminderCall,
  getCall,
  listCalls,
  buildAssistantConfig,
};
