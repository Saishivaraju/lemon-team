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
const AGENT_NAME           = process.env.AGENT_NAME    || 'Priya';
const COMPANY_NAME         = process.env.COMPANY_NAME  || 'Zorvo Realty';
const BASE_URL             = process.env.BASE_URL       || 'https://real-estate-web-liard-rho.vercel.app';

// ── Make outbound call via VAPI ───────────────────────────────────────────────
async function makeOutboundCall(lead, properties = []) {
  if (!VAPI_API_KEY) {
    console.warn('⚠️  VAPI_API_KEY not set — simulating call');
    return { success: true, simulated: true, id: 'sim_' + Date.now() };
  }

  const { default: fetch } = await import('node-fetch');

  // Format property list for the AI
  const propertyList = properties.length > 0
    ? properties.map((p, i) =>
        `${i+1}. ${p.name || p.title} — ${p.property_type || 'Property'} — ${p.location || 'N/A'} — ${p.price_label || p.price || 'Contact agent'}`
      ).join('\n')
    : 'Properties will be loaded dynamically.';

  // Build dynamic assistant override with lead context and property knowledge
  const assistantOverrides = {
    variableValues: {
      leadName:         lead.name              || 'there',
      propertyInterest: lead.property_interest || 'properties',
      budget:           lead.budget            || 'flexible',
      agentName:        lead.assigned_agent_name || AGENT_NAME,
      companyName:      COMPANY_NAME,
    },
    model: {
      messages: [
        {
          role: 'system',
          content: `You are ${AGENT_NAME} from ${COMPANY_NAME}. You are calling a lead who interested in ${lead.property_interest || 'real estate'}.\n\nOUR CURRENT LISTINGS:\n${propertyList}\n\nGOAL: Verify interest and book a visit.`
        }
      ]
    },
    firstMessage: `Hi ${lead.name || 'there'}! This is ${lead.assigned_agent_name || AGENT_NAME} calling from ${COMPANY_NAME}. You recently showed interest in ${lead.property_interest || 'one of our properties'} on our website. Is this a good time for a quick chat?`,
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

// ── Make outbound reminder call via VAPI ──────────────────────────────────────
async function makeReminderCall(visit) {
  if (!VAPI_API_KEY) return { success: true, simulated: true };
  const { default: fetch } = await import('node-fetch');

  const body = {
    assistantId:   VAPI_ASSISTANT_ID,
    assistantOverrides: {
      firstMessage: `Hi ${visit.client_name || 'there'}! This is ${AGENT_NAME} from ${COMPANY_NAME}. Just a friendly reminder that your property visit for ${visit.property_name || 'our property'} is scheduled for tomorrow at ${visit.visit_time || 'the confirmed time'}. We are looking forward to seeing you! Do you have any questions before then?`,
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
function buildAssistantConfig(properties = []) {
  const propertyList = properties.length > 0
    ? properties.map((p, i) =>
        `${i+1}. ${p.name || p.title} — ${p.property_type || 'Property'} — ${p.location || 'N/A'} — ${p.price_label || p.price || 'Contact agent'}`
      ).join('\n')
    : 'Properties will be loaded dynamically.';

  return {
    name: `${AGENT_NAME} — ${COMPANY_NAME}`,
    firstMessageMode: 'assistant-speaks-first',
    model: {
      provider: 'openai',
      model:    'gpt-4o-mini',
      messages: [
        {
          role:    'system',
          content: `You are ${AGENT_NAME}, a friendly and expert real estate agent at ${COMPANY_NAME}.

You are on a LIVE PHONE CALL with a potential property buyer.

YOUR PERSONALITY:
- Warm, friendly, confident, professional
- Sound exactly like a real human — not a robot
- Use natural phrases: "Absolutely!", "That is wonderful!", "Oh great!", "I totally understand"
- Be genuinely excited about helping them find their home
- Never rush the customer
- Always end your turn with a question to keep conversation going

OUR CURRENT PROPERTY LISTINGS:
${propertyList}

YOUR CALL GOALS (in order):
1. Greet warmly and ask how they are
2. Ask what property type they need
3. Ask preferred location and budget
4. Match them to best property from listings
5. Describe matched property naturally and excitedly  
6. Offer to book a visit — ask preferred date and time
7. Confirm date + time then call bookVisit function
8. After booking — congratulate them warmly

EDGE CASES:
- "call me later" or "busy" → Ask "Of course! Is tomorrow morning or evening better?" — do NOT end call
- "not interested" → Ask "Totally understand! Was it the price or location?" then close warmly
- "want human agent" → Say "Absolutely, I am alerting our agent right now!" then use transferCall
- silence twice → Close warmly and say agent will follow up

STRICT RULES:
- Max 2-3 SHORT sentences per reply — this is a phone call
- Never use bullet points or symbols in speech
- Never say you are an AI
- Sound 100% natural and human`,
        },
      ],
      functions: [
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
  makeOutboundCall,
  makeReminderCall,
  getCall,
  listCalls,
  buildAssistantConfig,
};
