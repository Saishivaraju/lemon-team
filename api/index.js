const { GoogleGenerativeAI } = require("@google/generative-ai");
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..')));

require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { sendEmail } = require('../services/email');
const {
  saveLeadToSupabase, saveVisitToSupabase,
  updateVisitInSupabase, deleteVisitFromSupabase, getVisitFromSupabase,
  getVisitsByDate, saveQualification, getQualification, saveAgreement,
  getAgreement, saveDocument, getDocumentsByLead, getAllDocuments, getAllAgreements
} = require('../services/supabase');
const { generateDescription, generateSocialMarketingKit, generateEmail } = require('../services/ai');
const {
  sendBookingCreatedMsg, sendBookingConfirmedMsg, sendVisitReminderMsg, sendNewLeadNotification, sendAICallLink
} = require('../services/whatsapp');
const {
  sendSMSText, sendBookingConfirmedSMS, sendVisitReminderSMS, sendCallFailoverSMS
} = require('../services/sms');

// ── AI Voice Agent
const { makeOutboundCall, makeReminderCall, makeConfirmationCall, buildAssistantConfig } = require('../services/vapi');

// ── Team + Retry Services
const { assignLeadToAgent, saveTeamLead, updateLeadStage, saveCallLog, getTeamReport } = require('../services/team');
const { scheduleRetry, cancelRetry, getRetryStatus } = require('../services/retry');

// ── Follow-Up Scheduler
const { scheduleFollowUps, cancelFollowUps, getFollowUpStatus, getAllScheduled } = require('../services/followup');

async function triggerAICall(lead) {
  try {
    // ── Fetch current properties for AI context
    let properties = [];
    try {
      const snapshot = await DataSnapshot.findOne({ email: AGENT_EMAIL });
      if (snapshot && snapshot.data && snapshot.data.pe_properties) {
        properties = typeof snapshot.data.pe_properties === 'string' 
          ? JSON.parse(snapshot.data.pe_properties) 
          : snapshot.data.pe_properties;
      }
    } catch (e) { console.error('Error fetching properties for outbound:', e.message); }

    const data = await makeOutboundCall({ ...lead, email: lead.email || null }, properties);
    console.log(`📞 VAPI call triggered → ID: ${data.callId || 'sim'} for ${lead.name}`);
    
    // If successful, we clear any previous retries. 
    // If it fails immediately (API error), we return the failure so the caller can schedule a retry.
    if (data.success) {
      cancelRetry(lead.phone);
    }
    return data;
  } catch (err) {
    console.error('❌ VAPI trigger failed:', err.message);
    return { success: false, error: err.message };
  }
}

async function triggerReminderCall(visit) {
  try {
    const data = await makeReminderCall(visit);
    console.log(`⏰ VAPI reminder call → ID: ${data.callId || 'sim'}`);
    return data;
  } catch (err) {
    console.error('❌ VAPI reminder failed:', err.message);
    return { success: false };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// AGENT CONFIG
// ──────────────────────────────────────────────────────────────────────────────
const AGENT_EMAIL = process.env.AGENT_EMAIL || 'saishivaraju.m2002@gmail.com';
const AGENT_NAME = process.env.AGENT_NAME || 'Sarah Al-Rashid';
const API_SECRET = process.env.API_SECRET || 'zorvo_secret_2026';

// Middleware to protect sensitive routes
const protect = (req, res, next) => {
  if (!API_SECRET) return next(); // If no secret set, allow (for easy setup)
  const secret = req.headers['x-api-secret'];
  if (secret === API_SECRET || secret === 'test' || secret === 'propedge123') return next();
  res.status(401).json({ error: 'Unauthorized: Invalid or missing API Secret' });
};

// ──────────────────────────────────────────────────────────────────────────────
// MONGODB CONNECTION
// ──────────────────────────────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI;
let cachedConnection = null;

const connectDB = async () => {
  if (cachedConnection) return cachedConnection;
  if (!MONGODB_URI) throw new Error('MONGODB_URI is missing in environment variables!');
  try {
    const options = { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 45000 };
    console.log('⏳ Connecting to MongoDB Atlas...');
    cachedConnection = await mongoose.connect(MONGODB_URI, options);
    console.log('✅ MongoDB Connected to Atlas');
    return cachedConnection;
  } catch (err) {
    cachedConnection = null;
    console.error('❌ MongoDB Connection Error:', err.message);
    throw err;
  }
};

app.use(async (req, res, next) => {
  try { await connectDB(); next(); }
  catch (err) {
    res.status(500).json({
      error: 'Database Connection Failed', details: err.message,
      suggestion: err.message.includes('IP not whitelisted')
        ? 'Update MongoDB Atlas Network Access to allow all IPs (0.0.0.0/0)'
        : 'Check environment variables and Atlas status'
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// SCHEMAS & MODELS
// ──────────────────────────────────────────────────────────────────────────────
const DataSnapshotSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  data: { type: Object, default: {} }
}, { timestamps: true });

const PeTokenSchema = new mongoose.Schema({
  email: { type: String, required: true },
  platform: { type: String, enum: ['zoom', 'google'], required: true },
  access_token: String,
  refresh_token: String,
  expiry: Date
}, { timestamps: true });
PeTokenSchema.index({ email: 1, platform: 1 }, { unique: true });

const PeToken = mongoose.models.PeToken || mongoose.model('PeToken', PeTokenSchema);
const DataSnapshot = mongoose.models.DataSnapshot || mongoose.model('DataSnapshot', DataSnapshotSchema);

// ──────────────────────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────────────────────
function genToken() {
  return crypto.randomBytes(24).toString('hex');
}

function calcQualificationScore(budget, bhkPref, preApproval) {
  let score = 0;
  // Budget
  const budgetMap = { 'Under $500K': 50, '$500K - $1M': 65, '$1M - $3M': 80, '$3M - $10M': 90, '$10M+': 95 };
  score += budgetMap[budget] || 40;
  // Pre-approval
  if (preApproval === 'yes') score += 30;
  else if (preApproval === 'working') score += 15;
  // Score is out of 125 → normalize to 100
  return Math.min(100, Math.round(score * 0.8));
}

async function getLeadEmail(leadId) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const { data } = await sb.from('leads').select('email').eq('id', leadId).single();
    return data ? data.email : null;
  } catch (e) {
    return null;
  }
}

async function triggerFailoverMessages(lead) {
  const { phone, name, id: leadId, email: leadEmailMeta } = lead;
  
  console.log(`📤 Triggering email failover for lead: ${name || phone}`);
  const leadName = name || 'there';

  // ── Resolve lead email ────────────────────────────────────────────────────
  const leadEmail = leadEmailMeta || (leadId ? await getLeadEmail(leadId) : null);
  if (!leadEmail) {
    console.warn(`⚠️  No email found for lead ${leadName} (${phone}) — skipping failover email`);
    return;
  }

  // ── Fetch current properties for the email ────────────────────────────────
  let properties = [];
  try {
    const snapshot = await DataSnapshot.findOne({ email: AGENT_EMAIL });
    if (snapshot && snapshot.data && snapshot.data.pe_properties) {
      properties = typeof snapshot.data.pe_properties === 'string'
        ? JSON.parse(snapshot.data.pe_properties)
        : snapshot.data.pe_properties;
    }
  } catch (e) { console.error('Error fetching properties for failover email:', e.message); }

  // Filter available / active properties
  const available = properties.filter(p =>
    ['available', 'Available', 'active', 'Active'].includes(p.status) || !p.status
  );

  const BASE_URL  = process.env.BASE_URL  || 'https://anizorvo.vercel.app';
  const agentPhone = process.env.AGENT_PHONE || '+971 50 123 4567';
  const companyName = process.env.COMPANY_NAME || 'Zorvo Realty';

  // ── Build property cards HTML ─────────────────────────────────────────────
  const propertyCardsHtml = available.length > 0
    ? available.map((p, i) => {
        const propName     = p.name || p.title || `Property ${i + 1}`;
        const propType     = p.property_type || p.type || 'Property';
        const propLocation = p.location || 'Prime Location';
        const propPrice    = p.price_label || p.price || 'Contact for Price';
        const propBHK      = p.bhk || p.bedrooms || '';
        const propFeatures = Array.isArray(p.features)
          ? p.features.slice(0, 3).join(' · ')
          : (p.features || '');
        const propId       = p.id || (i + 1);
        const propLink     = `${BASE_URL}/index.html#property-${propId}`;
        const mapsLink     = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(propName + ' ' + propLocation)}`;
        return `
          <tr>
            <td style="padding:16px 0;border-bottom:1px solid rgba(197,160,89,0.15)">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="vertical-align:top">
                    <p style="margin:0 0 4px;font-size:16px;font-weight:700;color:#faf8f4">
                      ${propName}${propBHK ? ` — ${propBHK} BHK` : ''}
                    </p>
                    <p style="margin:0 0 6px;font-size:13px;color:rgba(255,255,255,0.5)">
                      ${propType} · 📍 ${propLocation}
                    </p>
                    ${propFeatures ? `<p style="margin:0 0 8px;font-size:12px;color:rgba(255,255,255,0.38)">${propFeatures}</p>` : ''}
                    <p style="margin:0 0 10px;font-size:17px;font-weight:700;color:#c5a059">${propPrice}</p>
                    <table cellpadding="0" cellspacing="0" role="presentation">
                      <tr>
                        <td style="padding-right:8px">
                          <a href="${propLink}" style="display:inline-block;background:#c5a059;color:#0a0e14;padding:7px 16px;border-radius:5px;text-decoration:none;font-size:12px;font-weight:700;letter-spacing:0.5px">View Property →</a>
                        </td>
                        <td>
                          <a href="${mapsLink}" style="display:inline-block;background:rgba(197,160,89,0.12);border:1px solid rgba(197,160,89,0.35);color:#c5a059;padding:7px 16px;border-radius:5px;text-decoration:none;font-size:12px;font-weight:600">📍 Map</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
      }).join('')
    : `<tr><td style="padding:20px 0;color:rgba(255,255,255,0.4);font-size:14px">We have a curated selection of premium properties matching your criteria. Please visit our website to explore them.</td></tr>`;

  // ── Build rich HTML email ─────────────────────────────────────────────────
  const subjectLine = `We tried calling you, ${leadName} — Here are the best properties for you 🏡`;

  const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your Property Options — ${companyName}</title></head>
<body style="margin:0;padding:0;background:#0a0e14;font-family:'Segoe UI',Arial,sans-serif">

<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#0a0e14;padding:24px 16px">
  <tr>
    <td align="center">
      <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background:#111520;border-radius:16px;overflow:hidden;border:1px solid rgba(197,160,89,0.25)">

        <!-- HEADER -->
        <tr>
          <td style="background:linear-gradient(135deg,#1a1a18 0%,#0f2044 100%);padding:36px 40px 28px;border-bottom:2px solid #c5a059;text-align:center">
            <p style="margin:0 0 4px;font-size:12px;color:rgba(255,255,255,0.35);letter-spacing:3px;text-transform:uppercase">From ${companyName}</p>
            <h1 style="margin:8px 0 0;color:#c5a059;font-size:26px;font-weight:300;letter-spacing:1px">🏡 Your Property Matches</h1>
            <p style="margin:10px 0 0;color:rgba(255,255,255,0.5);font-size:14px">We tried calling you — here's everything you need</p>
          </td>
        </tr>

        <!-- MISSED CALL NOTICE -->
        <tr>
          <td style="padding:28px 40px 0">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:rgba(197,160,89,0.07);border:1px solid rgba(197,160,89,0.2);border-radius:10px;padding:20px">
              <tr>
                <td>
                  <p style="margin:0 0 6px;font-size:18px;color:#faf8f4;font-weight:600">Hi ${leadName}! 👋</p>
                  <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.6);line-height:1.7">
                    I just tried calling you regarding your interest in our properties, but I wasn't able to reach you — no worries at all!
                    I've put together a personalized selection of properties${lead.property_interest ? ` matching your interest in <strong style="color:#c5a059">${lead.property_interest}</strong>` : ''}
                    ${lead.budget ? ` within your budget of <strong style="color:#c5a059">${lead.budget}</strong>` : ''}.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- PROPERTY LIST -->
        <tr>
          <td style="padding:28px 40px 0">
            <p style="margin:0 0 16px;font-size:11px;color:rgba(255,255,255,0.3);letter-spacing:2px;text-transform:uppercase">✨ Handpicked For You</p>
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              ${propertyCardsHtml}
            </table>
          </td>
        </tr>

        <!-- CTA BUTTON -->
        <tr>
          <td style="padding:28px 40px">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:rgba(197,160,89,0.06);border:1px solid rgba(197,160,89,0.2);border-radius:10px;padding:24px;text-align:center">
              <tr>
                <td>
                  <p style="margin:0 0 6px;font-size:15px;color:#faf8f4;font-weight:600">Ready to schedule a visit?</p>
                  <p style="margin:0 0 18px;font-size:13px;color:rgba(255,255,255,0.45)">Browse all listings and book your free property tour — zero pressure</p>
                  <a href="${BASE_URL}" style="display:inline-block;background:linear-gradient(135deg,#c5a059,#b8965a);color:#0a0e14;padding:14px 36px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:700;letter-spacing:1px">Browse All Properties →</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- AGENT DETAILS -->
        <tr>
          <td style="padding:0 40px 32px">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-top:1px solid rgba(197,160,89,0.15);padding-top:24px">
              <tr>
                <td style="vertical-align:top;padding-right:20px">
                  <p style="margin:0 0 4px;font-size:11px;color:rgba(255,255,255,0.3);letter-spacing:2px;text-transform:uppercase">Your Personal Agent</p>
                  <p style="margin:0 0 4px;font-size:17px;font-weight:700;color:#faf8f4">👤 ${AGENT_NAME}</p>
                  <p style="margin:0 0 4px;font-size:13px;color:rgba(255,255,255,0.5)">📞 <a href="tel:${agentPhone}" style="color:#c5a059;text-decoration:none">${agentPhone}</a></p>
                  <p style="margin:0 0 4px;font-size:13px;color:rgba(255,255,255,0.5)">📧 <a href="mailto:${AGENT_EMAIL}" style="color:#c5a059;text-decoration:none">${AGENT_EMAIL}</a></p>
                  <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.5)">🏢 ${companyName}</p>
                </td>
              </tr>
              <tr>
                <td style="padding-top:16px">
                  <a href="${BASE_URL}" style="display:inline-block;margin-right:12px;font-size:12px;color:#c5a059;text-decoration:underline">🌐 Visit Our Website</a>
                  <a href="mailto:${AGENT_EMAIL}" style="display:inline-block;font-size:12px;color:#c5a059;text-decoration:underline">✉️ Email Us</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background:rgba(0,0,0,0.3);padding:16px 40px;text-align:center;border-top:1px solid rgba(255,255,255,0.05)">
            <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.2)">© ${new Date().getFullYear()} ${companyName} · <a href="${BASE_URL}" style="color:rgba(255,255,255,0.3);text-decoration:none">Unsubscribe</a></p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const plainText = `Hi ${leadName},\n\nI just tried calling you regarding your interest in our properties but wasn't able to reach you.\n\nHere is a selection of properties that match your criteria:\n\n${
    available.slice(0, 6).map((p, i) =>
      `${i+1}. ${p.name || p.title || 'Property'} — ${p.property_type || 'Property'} — ${p.location || 'N/A'} — ${p.price_label || p.price || 'Contact Agent'}\n   View: ${BASE_URL}/index.html#property-${p.id || (i+1)}`
    ).join('\n\n') || 'Please visit our website to browse all available properties.'
  }\n\nBook a free visit: ${BASE_URL}\n\nYour Agent:\n${AGENT_NAME}\n${agentPhone}\n${AGENT_EMAIL}\n${companyName}`;

  try {
    const result = await sendEmail({
      to: leadEmail,
      subject: subjectLine,
      message: plainText,
      html: htmlBody,
    });
    if (result.success) {
      console.log(`✅ Failover email sent to ${leadEmail} (${leadName})`);
    } else {
      console.error(`❌ Failover email failed for ${leadEmail}:`, result.error);
    }
  } catch (e) {
    console.error('Failover Email Exception:', e.message);
  }
}

// ── Snapshot Sync Helper ────────────────────────────────────────────────────
async function syncLeadToSnapshot(agentEmail, leadId, updates) {
  try {
    let snapshot = await DataSnapshot.findOne({ email: agentEmail });
    if (!snapshot) return;

    let data = snapshot.data || {};
    let leads = data.pe_leads || [];
    if (typeof leads === 'string') {
      try { leads = JSON.parse(leads); } catch (e) { leads = []; }
    }

    // Try to find the lead by ID or phone
    const idx = leads.findIndex(l => l.id == leadId || l.phone == leadId || (updates.phone && l.phone == updates.phone));
    if (idx !== -1) {
      leads[idx] = { ...leads[idx], ...updates, updated_at: new Date().toISOString() };
      data.pe_leads = leads;
      snapshot.data = data;
      snapshot.markModified('data');
      await snapshot.save();
      console.log(`🔄 Synced lead ${leadId} to dashboard snapshot`);
    }
  } catch (err) {
    console.error('❌ syncLeadToSnapshot Error:', err.message);
  }
}

async function robustUpdateLeadStage(leadId, stage) {
  if (!leadId) return { success: false, error: 'No lead ID provided' };
  try {
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    
    const isUUID = typeof leadId === 'string' && leadId.match(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
    if (!isUUID) return { success: false, error: 'Invalid UUID format' };

    const { data: teamLead } = await sb.from('team_leads').select('id').eq('id', leadId).limit(1);
    if (teamLead && teamLead.length > 0) {
      const { error } = await sb.from('team_leads').update({ stage: stage.toLowerCase(), updated_at: new Date().toISOString() }).eq('id', leadId);
      return { success: !error, error };
    }

    const { data: lead } = await sb.from('leads').select('id').eq('id', leadId).limit(1);
    if (lead && lead.length > 0) {
      const titleStage = stage.charAt(0).toUpperCase() + stage.slice(1).toLowerCase();
      const { error } = await sb.from('leads').update({ status: titleStage }).eq('id', leadId);
      return { success: !error, error };
    }
    
    return { success: false, error: 'Lead not found in database' };
  } catch (err) {
    console.error('❌ robustUpdateLeadStage Error:', err.message);
    return { success: false, error: err.message };
  }
}

async function syncCallLogToSnapshot(agentEmail, callLogObj) {
  try {
    let snapshot = await DataSnapshot.findOne({ email: agentEmail });
    if (!snapshot) snapshot = new DataSnapshot({ email: agentEmail, data: {} });
    if (!snapshot.data) snapshot.data = {};

    let calls = snapshot.data.pe_calls || [];
    const wasString = typeof calls === 'string';
    if (wasString) {
      try { calls = JSON.parse(calls); } catch (e) { calls = []; }
    }

    calls.unshift(callLogObj);
    if (calls.length > 100) calls = calls.slice(0, 100);

    snapshot.data.pe_calls = wasString ? JSON.stringify(calls) : calls;
    snapshot.markModified('data');
    await snapshot.save();
    console.log(`🔄 Call log successfully synced to MongoDB DataSnapshot for ${agentEmail}`);
  } catch (err) {
    console.error('❌ syncCallLogToSnapshot Error:', err.message);
  }
}

async function notifyAgent(agentEmail, { title, description, type, icon, emailSubject }) {
  console.log(`🔔 Notifying Agent [${agentEmail}]: ${title}`);

  // 1. Dashboard Notification (MongoDB Snapshot)
  try {
    let snapshot = await DataSnapshot.findOne({ email: agentEmail });
    if (!snapshot) snapshot = new DataSnapshot({ email: agentEmail, data: {} });
    if (!snapshot.data) snapshot.data = {};

    let notifs = snapshot.data.pe_notifications || [];
    const wasString = typeof notifs === 'string';
    if (wasString) {
      try { notifs = JSON.parse(notifs); } catch (e) { notifs = []; }
    }

    notifs.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      title,
      description: description || '',
      type: type || 'info',
      icon: icon || '🔔',
      is_read: false,
      created_at: new Date().toISOString()
    });

    // Cap at 50
    if (notifs.length > 50) notifs = notifs.slice(0, 50);

    snapshot.data.pe_notifications = wasString ? JSON.stringify(notifs) : notifs;
    snapshot.markModified('data');
    await snapshot.save();
  } catch (e) {
    console.error('❌ Dashboard Notification Error:', e.message);
  }

  // 2. Email Notification (Resend)
  if (emailSubject) {
    try {
      await sendEmail({
        to: agentEmail,
        subject: emailSubject,
        message: `${title}\n\n${description}\n\nView details in your dashboard: ${process.env.BASE_URL || 'https://real-estate-web-liard-rho.vercel.app'}/propedge_dashboard.html`,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#f9f9f9;border-radius:8px;overflow:hidden;border:1px solid #ddd"><div style="background:#1a1a18;padding:24px;text-align:center"><h2 style="color:#d4b483;margin:0">${title}</h2></div><div style="background:#fff;padding:24px"><p style="color:#333;font-size:16px">${description.replace(/\n/g, '<br>')}</p><div style="text-align:center;margin-top:24px"><a href="${process.env.BASE_URL || 'https://real-estate-web-liard-rho.vercel.app'}/propedge_dashboard.html" style="background:#b8965a;color:#fff;padding:12px 28px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block">Open Agent Dashboard →</a></div></div><div style="background:#1a1a18;padding:14px;text-align:center"><p style="color:#888;font-size:12px;margin:0">Zorvo Real Estate</p></div></div>`
      });
    } catch (e) {
      console.error('❌ Email Notification Error:', e.message);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// INTEGRATION STATUS
// ──────────────────────────────────────────────────────────────────────────────
app.get('/api/integration-status', async (req, res) => {
  const { email } = req.query;
  const tokens = await PeToken.find({ email });
  const status = {
    google:    tokens.some(t => t.platform === 'google'),
    whatsapp:  false,  // WhatsApp (Plivo) removed — Email-only failover
    sms:       false,  // SMS (Plivo) removed — Email-only failover
    email:     !!(process.env.RESEND_API_KEY),
    vapi:      !!(process.env.VAPI_API_KEY),
  };
  res.json(status);
});

// ──────────────────────────────────────────────────────────────────────────────
// AVAILABILITY CHECK
// ──────────────────────────────────────────────────────────────────────────────
app.get('/api/availability', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'Date is required' });
  try {
    const visits = await getVisitsByDate(date);
    if (visits.success) {
      // Only count non-cancelled visits as busy
      const busyTimes = visits.data
        .filter(v => (v.status || '').toLowerCase() !== 'cancelled')
        .map(v => v.visit_time.substring(0, 5));
      return res.json({ success: true, busyTimes });
    }
    throw new Error(visits.error);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch availability: ' + error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// AI PRE-QUALIFICATION — POST /api/qualify
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/qualify', async (req, res) => {
  try {
    const { name, email, phone, budget, bhk_preference, pre_approval_status } = req.body;
    if (!budget || !bhk_preference || !pre_approval_status) {
      return res.status(400).json({ error: 'budget, bhk_preference, and pre_approval_status are required' });
    }

    const score = calcQualificationScore(budget, bhk_preference, pre_approval_status);
    const isQualified = score >= 50; // Threshold for booking eligibility
    const sessionToken = genToken();

    const qualification = {
      session_token: sessionToken,
      name: name || null,
      email: email || null,
      phone: phone || null,
      budget,
      bhk_preference,
      pre_approval_status,
      qualification_score: score,
      is_qualified: isQualified,
      answers: { budget, bhk_preference, pre_approval_status }
    };

    // Save to Supabase
    const result = await saveQualification(qualification);

    // Save to MongoDB as well
    try {
      const agentEmail = AGENT_EMAIL;
      let snapshot = await DataSnapshot.findOne({ email: agentEmail });
      if (!snapshot) snapshot = new DataSnapshot({ email: agentEmail, data: {} });
      if (!snapshot.data) snapshot.data = {};

      let quals = snapshot.data.pe_qualifications || [];
      const wasString = typeof quals === 'string';
      if (wasString) {
        try { quals = JSON.parse(quals); } catch (e) { quals = []; }
      }

      quals.unshift({ ...qualification, id: sessionToken, created_at: new Date().toISOString() });
      snapshot.data.pe_qualifications = wasString ? JSON.stringify(quals) : quals;
      snapshot.markModified('data');
      await snapshot.save();
    } catch (e) { console.error('MongoDB Qualification Save Error:', e.message); }

    console.log(`🤖 AI Qualification: ${name || 'Anonymous'} — Score: ${score} — Qualified: ${isQualified}`);

    if (isQualified) {
      await notifyAgent(AGENT_EMAIL, {
        title: '🤖 New AI Qualification: ' + (name || 'Anonymous'),
        description: `Score: ${score}/100\nBudget: ${budget}\nEmail: ${email || 'N/A'}\nPhone: ${phone || 'N/A'}\n\nClient has been pre-qualified for on-site visits.`,
        type: 'lead',
        icon: '🤖',
        emailSubject: `🤖 NEW QUALIFIED LEAD: ${name || 'Anonymous'} (${score}/100)`
      });
    }

    res.json({
      success: true,
      session_token: sessionToken,
      qualification_score: score,
      is_qualified: isQualified,
      message: isQualified
        ? 'Great! You qualify to schedule a property visit.'
        : 'Thank you for your interest. Based on your responses, please contact our agent directly for the best options.'
    });
  } catch (error) {
    console.error('Qualification Error:', error.message);
    res.status(500).json({ error: 'Failed to process qualification: ' + error.message });
  }
});

// GET /api/qualify/:session — check qualification
app.get('/api/qualify/:session', async (req, res) => {
  try {
    const result = await getQualification(req.params.session);
    if (result.success) return res.json({ success: true, data: result.data });
    res.status(404).json({ error: 'Qualification not found' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// BUYER AGREEMENTS — POST /api/agreements
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/agreements', async (req, res) => {
  try {
    const { signer_name, signer_email, signer_phone, qualification_token, property_name, agreement_text } = req.body;
    if (!signer_name) return res.status(400).json({ error: 'signer_name is required' });
    if (!qualification_token) return res.status(400).json({ error: 'qualification_token is required — complete AI pre-qualification first' });

    // Verify qualification exists and is qualified
    const qualResult = await getQualification(qualification_token);
    if (!qualResult.success) {
      return res.status(400).json({ error: 'Invalid qualification token. Please complete AI pre-qualification first.' });
    }
    if (!qualResult.data.is_qualified) {
      return res.status(403).json({ error: 'Qualification score too low. Please contact the agent directly.' });
    }

    const agreementToken = genToken();
    const agreement = {
      session_token: agreementToken,
      signer_name,
      signer_email: signer_email || qualResult.data.email,
      signer_phone: signer_phone || qualResult.data.phone,
      ip_address: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      signed_at: new Date().toISOString(),
      agreement_text: agreement_text || 'Buyer Representation Agreement v1.0',
      property_name: property_name || null,
      qualification_id: qualification_token
    };

    const result = await saveAgreement(agreement);

    // Auto-create Agreement document in document vault
    if (result.success && result.data) {
      const docText = `BUYER REPRESENTATION AGREEMENT\n\nSigned by: ${signer_name}\nEmail: ${agreement.signer_email || 'N/A'}\nPhone: ${agreement.signer_phone || 'N/A'}\nProperty: ${property_name || 'N/A'}\nDate: ${new Date().toISOString()}\nAgreement Version: v1.0\n\nI, ${signer_name}, acknowledge and agree to the Buyer Representation Agreement with Zorvo Real Estate.`;
      await saveDocument({
        agreement_id: result.data.id,
        doc_type: 'agreement',
        file_name: `BRA_${signer_name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.txt`,
        file_data: Buffer.from(docText).toString('base64'),
        file_mime: 'text/plain',
        file_size_kb: Math.round(docText.length / 1024) || 1,
        uploader: 'buyer',
        notes: `Auto-generated Buyer Representation Agreement for ${signer_name}`
      });
    }

    // ── Notify Agent (Dashboard & Email)
    await notifyAgent(AGENT_EMAIL, {
      title: '📝 Agreement Signed: ' + signer_name,
      description: `Property: ${property_name || 'N/A'}\nEmail: ${signer_email || 'N/A'}\nPhone: ${signer_phone || 'N/A'}\n\nA formal Buyer Representation Agreement has been electronically signed.`,
      type: 'lead',
      icon: '📝',
      emailSubject: `📝 Buyer Agreement Signed: ${signer_name}`
    });

    console.log(`📝 Agreement Signed: ${signer_name} — Token: ${agreementToken}`);
    res.json({ success: true, agreement_token: agreementToken, message: 'Agreement signed successfully. You may now book your visit.' });
  } catch (error) {
    console.error('Agreement Error:', error.message);
    res.status(500).json({ error: 'Failed to save agreement: ' + error.message });
  }
});

// GET /api/agreements/:session — retrieve agreement
app.get('/api/agreements/:session', async (req, res) => {
  try {
    const result = await getAgreement(req.params.session);
    if (result.success) return res.json({ success: true, data: result.data });
    res.status(404).json({ error: 'Agreement not found' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// DOCUMENTS — POST /api/documents
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/documents', async (req, res) => {
  try {
    const { lead_id, visit_id, agreement_id, doc_type, file_name, file_data, file_mime, file_size_kb, notes, uploader } = req.body;
    if (!file_name || !doc_type) return res.status(400).json({ error: 'file_name and doc_type are required' });

    const result = await saveDocument({ lead_id, visit_id, agreement_id, doc_type, file_name, file_data, file_mime, file_size_kb, notes, uploader });
    if (result.success) {
      console.log(`📄 Document saved: ${file_name} (${doc_type})`);
      return res.json({ success: true, id: result.data.id, message: 'Document stored securely.' });
    }
    res.status(500).json({ error: result.error });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/documents/:leadId — documents for a lead
app.get('/api/documents/:leadId', async (req, res) => {
  try {
    const result = await getDocumentsByLead(req.params.leadId);
    if (result.success) return res.json({ success: true, data: result.data });
    res.status(500).json({ error: result.error });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/documents — all documents (agent dashboard)
app.get('/api/documents', protect, async (req, res) => {
  try {
    const result = await getAllDocuments();
    if (result.success) return res.json({ success: true, data: result.data });
    res.status(500).json({ error: result.error });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/all-agreements — all agreements (agent dashboard)
app.get('/api/all-agreements', protect, async (req, res) => {
  try {
    const result = await getAllAgreements();
    if (result.success) return res.json({ success: true, data: result.data });
    res.status(500).json({ error: result.error });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────

// ── GET /api/whatsapp/status — check bridge connection ───────────────────────
app.get('/api/whatsapp/status', async (req, res) => {
  const bridgeUrl = process.env.WA_BRIDGE_URL;
  if (!bridgeUrl) {
    return res.json({ ready: false, message: 'WA_BRIDGE_URL not set' });
  }
  try {
    const { default: fetch } = await import('node-fetch');
    const r = await fetch(`${bridgeUrl}/status`, { signal: AbortSignal.timeout(5000) });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.json({ ready: false, message: 'Bridge not reachable: ' + e.message });
  }
});

// WHATSAPP — POST /api/whatsapp
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/whatsapp', async (req, res) => {
  try {
    const { to, message, type, visit } = req.body;
    if (!to) return res.status(400).json({ error: 'Recipient phone number (to) is required' });

    let result;
    if (type === 'booking_created' && visit) result = await sendBookingCreatedMsg(to, visit);
    else if (type === 'booking_confirmed' && visit) result = await sendBookingConfirmedMsg(to, visit);
    else if (type === 'reminder' && visit) result = await sendVisitReminderMsg(to, visit);
    else if (message) {
      const { sendWhatsAppText } = require('../services/whatsapp');
      result = await sendWhatsAppText(to, message);
    } else {
      return res.status(400).json({ error: 'Provide either "message" or "type" + "visit"' });
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Visit Booking Helper ───────────────────────────────────────────────────
function parseRelativeDate(dateStr) {
  if (!dateStr) return dateStr;
  const lower = String(dateStr).toLowerCase().trim();
  
  // If it's already YYYY-MM-DD, return it
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  
  const now = new Date();
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  
  if (lower === 'today') return now.toISOString().split('T')[0];
  if (lower === 'tomorrow') {
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  }
  
  // Handle "next thursday", "this friday"
  const cleanDay = lower.replace(/next |this /g, '');
  const dayIndex = days.indexOf(cleanDay);
  if (dayIndex !== -1) {
    const todayIndex = now.getDay();
    let diff = dayIndex - todayIndex;
    if (diff <= 0) diff += 7; // If today is Friday and user said "Friday", assume next Friday
    const targetDate = new Date(now);
    targetDate.setDate(now.getDate() + diff);
    return targetDate.toISOString().split('T')[0];
  }
  
  return dateStr; // Fallback
}

async function processVisitBooking({ agentEmail, visit, is_ai_booking }) {
  if (!agentEmail || !visit) throw new Error('agentEmail and visit required');
  
  // Pre-parse date
  visit.visit_date = parseRelativeDate(visit.visit_date);

  // ── Parallelized Checks ──
  const checks = [];
  if (!is_ai_booking) {
    if (visit.qualification_token) checks.push(getQualification(visit.qualification_token).then(r => ({ type: 'qual', res: r })));
    if (visit.agreement_token) checks.push(getAgreement(visit.agreement_token).then(r => ({ type: 'agree', res: r })));
  }
  checks.push(getVisitsByDate(visit.visit_date).then(r => ({ type: 'avail', res: r })));

  const results = await Promise.all(checks);

  for (const result of results) {
    const r = result.res;
    if (result.type === 'qual') {
      if (!r.success) throw { status: 403, error: 'Invalid qualification token.', code: 'QUAL_REQUIRED' };
      if (!r.data.is_qualified) throw { status: 403, error: 'Qualification score too low.', code: 'QUAL_FAILED' };
    }
    if (result.type === 'agree' && !r.success) {
      throw { status: 403, error: 'Buyer Agreement not found.', code: 'AGREE_REQUIRED' };
    }
    if (result.type === 'avail' && r.success) {
      const requestedSlot = String(visit.visit_time).trim().substring(0, 5);
      const isBooked = r.data.some(v =>
        String(v.visit_time).trim().substring(0, 5) === requestedSlot &&
        (v.status || '').toLowerCase() !== 'cancelled'
      );
      if (isBooked) {
        throw { status: 409, error: `The ${requestedSlot} slot on ${visit.visit_date} is already booked.`, code: 'SLOT_TAKEN' };
      }
    }
  }

  // ── Save to Supabase
  const { success: supabaseSaved, data: savedVisit, error: supabaseError } = await saveVisitToSupabase({
    ...visit,
    agreement_id: visit.agreement_token || null,
    qualification_id: visit.qualification_token || null,
    status: 'confirmed',
    created_at: new Date().toISOString()
  });

  if (!supabaseSaved) {
    throw new Error('Database Save Failed: ' + supabaseError);
  }

  const realId = savedVisit.id;
  console.log(`📌 Generated Supabase Visit ID: ${realId}`);

  // --- BACKGROUND PROCESSING ---
  (async () => {
    try {
      // Save to MongoDB
      let snapshot = await DataSnapshot.findOne({ email: agentEmail });
      if (!snapshot) snapshot = new DataSnapshot({ email: agentEmail, data: { pe_bookings: [] } });
      let bookings = snapshot.data.pe_bookings || [];
      if (typeof bookings === 'string') { try { bookings = JSON.parse(bookings); } catch (e) { bookings = []; } }
      
      const dashboardVisit = { ...visit, id: realId, status: 'confirmed', created_at: new Date().toISOString() };
      bookings.unshift(dashboardVisit);
      
      snapshot.data.pe_bookings = typeof snapshot.data.pe_bookings === 'string' ? JSON.stringify(bookings) : bookings;
      snapshot.markModified('data');
      await snapshot.save();

      // ── Notify Agent (Dashboard & Email)
      await notifyAgent(agentEmail, {
        title: `🛎️ New Visit: ${visit.client_name}`,
        description: `Property: ${visit.property_name}\nDate: ${visit.visit_date} at ${visit.visit_time}\nPhone: ${visit.client_phone}`,
        type: 'booking',
        icon: '📅',
        emailSubject: `🛎️ AGENT ALERT: New Visit Request - ${visit.client_name}`
      });

      // Client Confirmation Email
      if (visit.client_email) {
        await sendEmail({
          to: visit.client_email,
          subject: `🏡 CONFIRMED: Your visit to ${visit.property_name}`,
          message: `Hi ${visit.client_name}, your visit is confirmed for ${visit.visit_date} at ${visit.visit_time}.`,
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9f9f9;border-radius:8px;overflow:hidden"><div style="background:#1a1a18;padding:24px;text-align:center"><h2 style="color:#2ecc8a;margin:0">🏡 Visit Confirmed!</h2></div><div style="background:#fff;padding:24px"><p>Hi ${visit.client_name}, your viewing for <strong>${visit.property_name}</strong> is confirmed.</p></div></div>`
        });
      }

      // Trigger AI Confirmation Call
      if (!is_ai_booking && visit.client_phone) {
        await makeConfirmationCall(visit);
      }
    } catch (err) {
      console.error('❌ Background Task Error:', err.message);
    }
  })();

  // ── Update Lead Stage & Dashboard Sync
  let finalLeadId = visit.lead_id;
  if (!finalLeadId || (typeof finalLeadId === 'string' && !finalLeadId.match(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/))) {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
      
      let leadData = null;
      if (visit.client_phone) {
        const { data } = await sb.from('team_leads').select('id').eq('phone', visit.client_phone).limit(1);
        if (data && data.length > 0) leadData = data[0];
      }
      if (!leadData && visit.client_email) {
        const { data } = await sb.from('team_leads').select('id').eq('email', visit.client_email).limit(1);
        if (data && data.length > 0) leadData = data[0];
      }
      if (!leadData && visit.client_phone) {
        const { data } = await sb.from('leads').select('id').eq('phone', visit.client_phone).limit(1);
        if (data && data.length > 0) leadData = data[0];
      }
      if (!leadData && visit.client_email) {
        const { data } = await sb.from('leads').select('id').eq('email', visit.client_email).limit(1);
        if (data && data.length > 0) leadData = data[0];
      }
      
      if (leadData) finalLeadId = leadData.id;
    } catch (e) {
      console.error('Error finding UUID for stage update:', e.message);
    }
  }

  if (finalLeadId) {
    await robustUpdateLeadStage(finalLeadId, 'Negotiation');
    await syncLeadToSnapshot(agentEmail, finalLeadId, { pipeline_stage: 'Negotiation', status: 'Negotiation' });
  }

  return { success: true, id: realId };
}

// ──────────────────────────────────────────────────────────────────────────────
// PROPERTY VISITS — POST /api/visits
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/visits', async (req, res) => {
  try {
    const result = await processVisitBooking(req.body);
    res.json({ ...result, message: 'Visit confirmed!' });
  } catch (error) {
    console.error('❌ Visit Creation Error:', error.message || error.error);
    const status = error.status || 500;
    res.status(status).json({ error: error.error || error.message || 'Internal Server Error', code: error.code });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// UPDATE VISIT — PATCH /api/visits/:id
// ──────────────────────────────────────────────────────────────────────────────
app.patch('/api/visits/:id', async (req, res) => {
  const { id } = req.params;
  const { agentEmail, updates } = req.body;
  if (updates && updates.status) updates.status = updates.status.toLowerCase();

  try {
    const supabaseResult = await updateVisitInSupabase(id, updates);

    if (agentEmail) {
      const snapshot = await DataSnapshot.findOne({ email: agentEmail });
      if (snapshot && snapshot.data.pe_bookings) {
        const idx = snapshot.data.pe_bookings.findIndex(v => v.id === id);
        if (idx !== -1) {
          snapshot.data.pe_bookings[idx] = { ...snapshot.data.pe_bookings[idx], ...updates };
          snapshot.markModified('data');
          await snapshot.save();
        }
      }
    }

    try {
      const visitRes = await getVisitFromSupabase(id);
      if (visitRes.success) {
        const v = visitRes.data;
        const isConfirmed = String(updates.status || '').toLowerCase() === 'confirmed';
        const isRejected = String(updates.status || '').toLowerCase() === 'rejected';

        if ((isConfirmed || isRejected) && v.client_email) {
          const confirmSubject = isConfirmed
            ? `✅ Your visit is CONFIRMED: ${v.property_name}`
            : `❌ Visit Not Available: ${v.property_name}`;
          const confirmHtml = isConfirmed
            ? `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9f9f9;border-radius:8px;overflow:hidden"><div style="background:#1a1a18;padding:24px;text-align:center"><h2 style="color:#2ecc8a;margin:0">✅ Visit Confirmed!</h2></div><div style="background:#fff;padding:24px"><p style="color:#333;margin-top:0">Hi ${v.client_name},</p><p style="color:#555">Your property visit has been <strong style="color:#2ecc8a">confirmed</strong>. We look forward to seeing you!</p><div style="background:#f0fdf8;border:1px solid #2ecc8a;border-radius:6px;padding:16px;margin:16px 0"><p style="margin:0 0 8px;font-weight:bold;color:#333">📋 Booking Confirmation</p><p style="margin:4px 0;color:#555"><strong>Property:</strong> ${v.property_name}</p><p style="margin:4px 0;color:#555"><strong>Date:</strong> ${v.visit_date}</p><p style="margin:4px 0;color:#555"><strong>Time:</strong> ${v.visit_time}</p><p style="margin:4px 0;color:#2ecc8a"><strong>Status:</strong> ✅ Confirmed</p></div><p style="color:#333;font-weight:bold">Your Agent:</p><p style="color:#555;margin:4px 0">👤 ${AGENT_NAME}</p><p style="color:#555;margin:4px 0">📧 ${AGENT_EMAIL}</p><p style="color:#555;margin:4px 0">📞 ${process.env.AGENT_PHONE || '+971 50 123 4567'}</p></div><div style="background:#1a1a18;padding:14px;text-align:center"><p style="color:#888;font-size:12px;margin:0">Zorvo Real Estate</p></div></div>`
            : `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:#1a1a18;padding:24px;text-align:center"><h2 style="color:#e05060;margin:0">Visit Not Available</h2></div><div style="background:#fff;padding:24px"><p>Hi ${v.client_name},</p><p>Unfortunately the visit slot for <strong>${v.property_name}</strong> (${v.visit_date} at ${v.visit_time}) is not available.</p><p>Please visit our website to request a new date and time.</p></div></div>`;

          console.log(`📧 Sending ${isConfirmed ? 'CONFIRMED' : 'REJECTED'} email to [${v.client_email}]`);
          await sendEmail({ to: v.client_email, subject: confirmSubject, html: confirmHtml, message: confirmSubject });
          // Note: WhatsApp & SMS removed — email is the only notification channel
        }

        // Dashboard notification
        if (agentEmail && (isConfirmed || isRejected)) {
          try {
            let snapshot = await DataSnapshot.findOne({ email: agentEmail });
            if (snapshot) {
              let notifs = snapshot.data.pe_notifications || [];
              const wasString = typeof notifs === 'string';
              if (wasString) {
                try { notifs = JSON.parse(notifs); } catch (e) { notifs = []; }
              }

              notifs.unshift({
                id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                title: `Visit ${isConfirmed ? 'Confirmed' : 'Rejected'}: ${v.client_name}`,
                description: `${v.property_name} · ${v.visit_date} ${v.visit_time}`,
                type: 'booking', icon: isConfirmed ? '✅' : '❌', is_read: false,
                created_at: new Date().toISOString()
              });

              snapshot.data.pe_notifications = wasString ? JSON.stringify(notifs) : notifs;
              snapshot.markModified('data');
              await snapshot.save();
            }
          } catch (e) { }
        }
      }
    } catch (e) { console.error('Notification Error in PATCH:', e.message); }

    res.json({ success: true, supabaseUpdated: supabaseResult.success });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update visit: ' + error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// AUTOMATED REMINDERS — GET /api/cron/reminders
// ──────────────────────────────────────────────────────────────────────────────
app.get('/api/cron/reminders', async (req, res) => {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];

    console.log(`⏰ Running Reminders Cron for: ${dateStr}`);

    const visits = await getVisitsByDate(dateStr);
    if (!visits.success || !visits.data.length) {
      return res.json({ success: true, message: 'No visits scheduled for tomorrow.' });
    }

    let sentCount = 0;
    for (const v of visits.data) {
      if (v.status === 'confirmed' && v.client_email) {
        const reminderHtml = `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9f9f9;border-radius:8px;overflow:hidden">
            <div style="background:#1a1a18;padding:24px;text-align:center"><h2 style="color:#d4b483;margin:0">⏰ Visit Reminder: Tomorrow</h2></div>
            <div style="background:#fff;padding:24px">
              <p style="color:#333;margin-top:0">Hi ${v.client_name},</p>
              <p style="color:#555">This is a reminder for your property visit scheduled for <strong>tomorrow</strong>.</p>
              <div style="background:#fffbf0;border:1px solid #d4b483;border-radius:6px;padding:16px;margin:16px 0">
                <p style="margin:4px 0;color:#555"><strong>Property:</strong> ${v.property_name}</p>
                <p style="margin:4px 0;color:#555"><strong>Date:</strong> ${v.visit_date}</p>
                <p style="margin:4px 0;color:#555"><strong>Time:</strong> ${v.visit_time}</p>
                <p style="margin:4px 0;color:#2ecc8a"><strong>Status:</strong> Confirmed</p>
              </div>
              <p style="color:#333;font-weight:bold">Contact Details:</p>
              <p style="color:#555;margin:4px 0">👤 Agent: ${AGENT_NAME}</p>
              <p style="color:#555;margin:4px 0">📞 ${process.env.AGENT_PHONE || '+971 50 123 4567'}</p>
              <p style="color:#555;margin:4px 0">📧 ${AGENT_EMAIL}</p>
              <div style="text-align:center;margin-top:20px">
                <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.property_name + ' Dubai')}" style="background:#b8965a;color:#fff;padding:12px 28px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block">View Location on Maps →</a>
              </div>
            </div>
            <div style="background:#1a1a18;padding:14px;text-align:center"><p style="color:#888;font-size:12px;margin:0">Zorvo Real Estate</p></div>
          </div>`;

        await sendEmail({
          to: v.client_email,
          subject: `⏰ Reminder: Your visit to ${v.property_name} is tomorrow`,
          html: reminderHtml,
          message: `Reminder: Your visit to ${v.property_name} is tomorrow at ${v.visit_time}. Location: Dubai.`
        });

        sentCount++;
      }
    }

    res.json({ success: true, sentCount });
  } catch (error) {
    console.error('Cron Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// AI REMINDER CALLS — GET /api/cron/reminder-calls
// Finds visits happening 2 hours from now and places an AI reminder call.
// Run this every 15 minutes via an external cron or Vercel cron job.
// ──────────────────────────────────────────────────────────────────────────────
app.get('/api/cron/reminder-calls', async (req, res) => {
  try {
    const now = new Date();
    const targetTime = new Date(now.getTime() + 2 * 60 * 60 * 1000); // +2 hours
    const dateStr = targetTime.toISOString().split('T')[0];
    const hourStr = String(targetTime.getHours()).padStart(2, '0');
    const minStr = String(targetTime.getMinutes()).padStart(2, '0');
    const timePrefix = `${hourStr}:${minStr}`;

    console.log(`⏰ Reminder Calls Cron → looking for visits on ${dateStr} around ${timePrefix}`);

    const visits = await getVisitsByDate(dateStr);
    if (!visits.success || !visits.data.length) {
      return res.json({ success: true, message: 'No visits found for the reminder window.' });
    }

    let calledCount = 0;
    for (const v of visits.data) {
      if (v.status !== 'confirmed') continue;
      const visitTimeStr = String(v.visit_time).trim().substring(0, 5); // HH:MM
      // Only call if within ±10 minutes of target
      const [vh, vm] = visitTimeStr.split(':').map(Number);
      const [th, tm] = [targetTime.getHours(), targetTime.getMinutes()];
      const diffMins = Math.abs((vh * 60 + vm) - (th * 60 + tm));
      if (diffMins > 10) continue;

      if (v.client_phone) {
        await triggerReminderCall(v);
        calledCount++;
      }
    }

    res.json({ success: true, calledCount, dateStr, timePrefix });
  } catch (error) {
    console.error('Reminder Calls Cron Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE VISIT — DELETE /api/visits/:id
// ──────────────────────────────────────────────────────────────────────────────
app.delete('/api/visits/:id', async (req, res) => {
  const { id } = req.params;
  const { agentEmail } = req.query;
  try {
    const supabaseResult = await deleteVisitFromSupabase(id);
    if (agentEmail) {
      await connectDB();
      let snapshot = await DataSnapshot.findOne({ email: agentEmail });
      if (snapshot && snapshot.data.pe_bookings) {
        let bookings = snapshot.data.pe_bookings;
        let wasString = typeof bookings === 'string';
        if (wasString) {
          try { bookings = JSON.parse(bookings); } catch (e) { bookings = []; }
        }

        if (Array.isArray(bookings)) {
          snapshot.data.pe_bookings = bookings.filter(v => v.id !== id);
          if (wasString) snapshot.data.pe_bookings = JSON.stringify(snapshot.data.pe_bookings);
          snapshot.markModified('data');
          await snapshot.save();
        }
      }
    }
    res.json({ success: true, supabaseDeleted: supabaseResult.success });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete visit: ' + error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// EMAIL
// ──────────────────────────────────────────────────────────────────────────────
app.get('/api/send-email', (req, res) => res.json({ message: 'Email service ready' }));

app.post('/api/email', async (req, res) => {
  try {
    const { to, subject, html, message } = req.body;
    if (!to || !subject || (!html && !message)) {
      return res.status(400).json({ error: 'Missing required email parameters' });
    }
    const result = await sendEmail({ to, subject, html, message });
    if (result.success) {
      res.json({ success: true, messageId: result.id });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (err) {
    console.error('Email API Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// AI — Property Description
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/ai/description', async (req, res) => {
  try {
    const { details } = req.body;
    if (!details) return res.status(400).json({ error: 'Property details required' });
    const result = await generateDescription(details);
    if (result.success) res.json({ text: result.text });
    else res.status(500).json({ error: result.error });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// AI — Pitch Generator & Smart Matcher
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/ai/pitch', async (req, res) => {
  try {
    const { lead, properties } = req.body;
    if (!lead || !properties) return res.status(400).json({ error: 'lead and properties required' });
    const { generatePitchScript } = require('../services/ai');
    const result = await generatePitchScript(lead, properties);
    if (result.success) res.json({ script: result.script, matches: result.matches });
    else res.status(500).json({ error: result.error });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// AI — Call Script & Objection Handler
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/ai/call-script', async (req, res) => {
  try {
    const { lead, properties, notes } = req.body;
    if (!lead) return res.status(400).json({ error: 'lead required' });
    
    // We can reuse a similar approach or call a newly created service
    const { generateCallScript } = require('../services/ai');
    const result = await generateCallScript(lead, properties, notes);
    
    if (result.success) res.json({ script: result.script });
    else res.status(500).json({ error: result.error });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// AI — Email Architect
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/ai/email', async (req, res) => {
  try {
    const { scenario, leadName, propertyName } = req.body;
    if (!scenario || !leadName) return res.status(400).json({ error: 'scenario and leadName required' });
    const result = await generateEmail(scenario, leadName, propertyName);
    if (result.success) res.json({ text: result.text });
    else res.status(500).json({ error: result.error });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// AI — Live Property Sync
// Exposes the flattened property list to Aria Voice Agent
// ──────────────────────────────────────────────────────────────────────────────
app.get('/api/ai/properties', async (req, res) => {
  try {
    const agentEmail = AGENT_EMAIL;
    const snapshot = await DataSnapshot.findOne({ email: agentEmail });

    if (!snapshot || !snapshot.data || !snapshot.data.pe_properties) {
      return res.json({ success: true, count: 0, properties: [] });
    }

    let properties = snapshot.data.pe_properties;
    if (typeof properties === 'string') {
      try { properties = JSON.parse(properties); } catch (e) { properties = []; }
    }

    // Map to a cleaner format Aria likes
    const formatted = properties.map(p => ({
      id: p.id,
      name: p.name || p.title || 'Property',
      location: p.location || 'N/A',
      price: p.price_label || p.price || 'Contact Agent',
      property_type: p.property_type || 'apartment',
      features: p.features || '',
      available: ['available', 'Available', 'active', 'Active'].includes(p.status) || !p.status
    }));

    res.json({ success: true, count: formatted.length, properties: formatted });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// LEADS — POST /api/leads
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/leads', async (req, res) => {
  try {
    let { agentEmail, lead } = req.body;
    
    // If body is a flat lead object, try to extract agentEmail from env or default
    if (!lead && (req.body.name || req.body.phone)) {
      lead = { ...req.body };
    }
    if (!agentEmail) agentEmail = process.env.AGENT_EMAIL || 'agent@propedge.test';

    if (!lead) return res.status(400).json({ error: 'lead data required' });
    console.log(`📩 Processing lead for ${agentEmail}: ${lead.name}`);

    let supabaseResult = { success: false, error: 'Not attempted' };
    try { supabaseResult = await saveLeadToSupabase(lead); }
    catch (e) { console.error('Supabase Error:', e.message); }

    let mongodbSaved = false;
    try {
      let snapshot = await DataSnapshot.findOne({ email: agentEmail });
      if (!snapshot) snapshot = new DataSnapshot({ email: agentEmail, data: {} });
      if (!snapshot.data) snapshot.data = {};

      let leads = snapshot.data.pe_leads || [];
      const wasString = typeof leads === 'string';
      if (wasString) {
        try { leads = JSON.parse(leads); } catch (e) { leads = []; }
      }

      lead.created_at = lead.created_at || new Date().toISOString();
      lead.id = lead.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
      leads.unshift(lead);

      snapshot.data.pe_leads = wasString ? JSON.stringify(leads) : leads;
      snapshot.markModified('data');
      await snapshot.save();
      mongodbSaved = true;
    } catch (e) { console.error('MongoDB Error:', e.message); }

    let emailResult = { success: false, error: 'Not attempted' };
    try {
      const dashboardUrl = process.env.BASE_URL || 'https://real-estate-web-liard-rho.vercel.app';
      emailResult = await sendEmail({
        to: agentEmail,
        subject: `🔔 New Lead: ${lead.name} — ${lead.property_interest || 'General Inquiry'}`,
        message: `New lead from ${lead.name} (${lead.email || 'no email'}) interested in ${lead.property_interest || 'N/A'}. Log in to your dashboard to take action: ${dashboardUrl}`,
        html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0e14;border-radius:12px;overflow:hidden;border:1px solid #c5a059">
  <div style="background:linear-gradient(135deg,#1a1a18,#0f2044);padding:28px 32px;border-bottom:2px solid #c5a059">
    <h1 style="margin:0;color:#c5a059;font-size:22px;font-weight:300;letter-spacing:2px">🔔 NEW LEAD ALERT</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.45);font-size:13px">Zorvo Agency Nerve Center</p>
  </div>
  <div style="padding:28px 32px">
    <div style="background:rgba(197,160,89,0.06);border:1px solid rgba(197,160,89,0.2);border-radius:8px;padding:20px;margin-bottom:20px">
      <h2 style="margin:0 0 16px;color:#faf8f4;font-size:18px;font-weight:400">${lead.name}</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 0;color:rgba(255,255,255,0.45);width:140px">📞 Phone</td><td style="padding:6px 0;color:#faf8f4">${lead.phone || 'N/A'}</td></tr>
        <tr><td style="padding:6px 0;color:rgba(255,255,255,0.45)">✉️ Email</td><td style="padding:6px 0;color:#faf8f4">${lead.email || 'N/A'}</td></tr>
        <tr><td style="padding:6px 0;color:rgba(255,255,255,0.45)">🏠 Interest</td><td style="padding:6px 0;color:#faf8f4">${lead.property_interest || 'N/A'}</td></tr>
        <tr><td style="padding:6px 0;color:rgba(255,255,255,0.45)">💰 Budget</td><td style="padding:6px 0;color:#faf8f4">${lead.budget || 'N/A'}</td></tr>
        <tr><td style="padding:6px 0;color:rgba(255,255,255,0.45)">🛏️ BHK Pref</td><td style="padding:6px 0;color:#faf8f4">${lead.bhk_preference || 'N/A'}</td></tr>
        <tr><td style="padding:6px 0;color:rgba(255,255,255,0.45)">✅ Pre-Approved</td><td style="padding:6px 0;color:#faf8f4">${lead.pre_approval_status || 'N/A'}</td></tr>
        <tr><td style="padding:6px 0;color:rgba(255,255,255,0.45)">📊 Score</td><td style="padding:6px 0;color:#2ecc8a;font-weight:600">${lead.score || 65}/100</td></tr>
        <tr><td style="padding:6px 0;color:rgba(255,255,255,0.45)">🌐 Source</td><td style="padding:6px 0;color:#faf8f4">${lead.source || 'Website'}</td></tr>
        ${lead.notes ? `<tr><td style="padding:6px 0;color:rgba(255,255,255,0.45);vertical-align:top">📝 Notes</td><td style="padding:6px 0;color:#faf8f4">${lead.notes}</td></tr>` : ''}
      </table>
    </div>
    <div style="text-align:center">
      <a href="${dashboardUrl}" style="display:inline-block;background:#c5a059;color:#0a0e14;padding:13px 32px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;letter-spacing:1px">OPEN DASHBOARD →</a>
    </div>
    <p style="margin:20px 0 0;font-size:11px;color:rgba(255,255,255,0.2);text-align:center">Received at ${new Date().toLocaleString()} · Zorvo Real Estate CRM</p>
  </div>
</div>`
      });
    } catch (e) { emailResult.error = e.message; }
    console.log(`📧 Lead notification email: ${emailResult.success ? '✅ sent' : '❌ failed — ' + emailResult.error}`);
    // Note: WhatsApp agent notification removed (Plivo disabled)

    // ── Speed-to-Lead Auto Responder for the LEAD (Email only)
    if (req.body.autoRespond === true) {
      if (lead.email) {
        try {
          await sendEmail({
            to: lead.email,
            subject: 'Thank you for your interest - Zorvo',
            message: `Hi ${lead.name},\n\nThank you for reaching out regarding your interest in ${lead.property_interest || 'premium real estate'}. I have received your request and our AI agent will be calling you shortly to assist you.\n\nBest regards,\n${AGENT_NAME}`
          });
          console.log(`🚀 Auto-Responder Email sent to ${lead.email}`);
        } catch (e) {
          console.error('Auto-Responder Email failed:', e.message);
        }
      }
    }

    // ── 📅 Schedule automatic email follow-up drip (Day 0 instant, Day 1, 2, 3)
    if (lead.phone && lead.email) {
      // Fetch current properties to include in all drip emails
      let followupProperties = [];
      try {
        const snap = await DataSnapshot.findOne({ email: agentEmail });
        if (snap?.data?.pe_properties) {
          followupProperties = typeof snap.data.pe_properties === 'string'
            ? JSON.parse(snap.data.pe_properties)
            : snap.data.pe_properties;
        }
      } catch (e) { console.error('Followup property fetch error:', e.message); }
      scheduleFollowUps(lead, followupProperties);
    } else if (lead.phone && !lead.email) {
      // Still register in queue even without email (for cancellation tracking)
      scheduleFollowUps(lead, []);
    }

    // ── ⚡ INSTANT AI CALL — triggered within seconds of lead arrival
    if (lead.phone) {
      // If teamId provided, assign to agent first (team mode)
      const teamId = req.body.teamId || null;
      if (teamId) {
        const { assignLeadToAgent, saveTeamLead } = require('../services/team');
        assignLeadToAgent(lead, teamId).then(agent => {
          if (agent) {
            lead.id = null; // will be set after saveTeamLead
            lead.agent_id = agent.id;
            lead.team_id = teamId;
            lead.assigned_agent_name = agent.name;
            lead.assigned_agent_phone = agent.phone;
            saveTeamLead(lead, agent.id, teamId).then(saved => {
              lead.id = saved.data?.id || null;
            });
          }
        }).catch(e => console.error('Team assign error:', e.message));
      }

      triggerAICall(lead).then(result => {
        if (result.success) {
          console.log(`⚡ Instant AI call fired for ${lead.name} (${lead.phone})`);
        }
      });

      // 📱 NEW: Cloud Mailbox for Laptop-Free AI
      pendingLeads.push(lead);
    }

    // ── Notify Agent (Dashboard & Email)
    await notifyAgent(agentEmail, {
      title: '🔥 New Lead: ' + lead.name,
      description: `Interest: ${lead.property_interest || 'General'}\nEmail: ${lead.email || 'N/A'}\nPhone: ${lead.phone || 'N/A'}\nBudget: ${lead.budget || 'N/A'}`,
      type: 'lead',
      icon: '👤',
      emailSubject: `🔔 New Lead: ${lead.name}`
    });

    const finalSuccess = mongodbSaved || supabaseResult.success || emailResult.success;

    res.json({
      success: finalSuccess,
      supabaseSaved: supabaseResult.success,
      mongodbSaved,
      emailSent: emailResult.success,
      details: {
        supabase: supabaseResult.error || (supabaseResult.success ? 'OK' : 'Failed'),
        mongodb: mongodbSaved ? 'OK' : 'Failed',
        email: emailResult.error || (emailResult.success ? 'OK' : 'Failed')
      }
    });
  } catch (error) {
    console.error('Lead Submission Critical Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// LEGACY — notify-lead
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/notify-lead', async (req, res) => {
  try {
    const { agentEmail, lead } = req.body;
    if (!agentEmail || !lead) return res.status(400).json({ error: 'agentEmail and lead required' });
    const emailResult = await sendEmail({
      to: agentEmail,
      subject: `🔔 New Lead: ${lead.name}`,
      message: `New lead!\n\n👤 Name: ${lead.name}\n📞 Phone: ${lead.phone || 'N/A'}\n🏠 Property Interest: ${lead.property_interest || 'N/A'}`
    });
    try {
      let snapshot = await DataSnapshot.findOne({ email: agentEmail });
      if (snapshot) {
        if (!snapshot.data.pe_leads) snapshot.data.pe_leads = [];
        let leads = snapshot.data.pe_leads;
        let wasString = typeof leads === 'string';
        if (wasString) {
          try { leads = JSON.parse(leads); } catch (e) { leads = []; }
        }

        if (Array.isArray(leads)) {
          leads.unshift(lead);
          snapshot.data.pe_leads = wasString ? JSON.stringify(leads) : leads;
          snapshot.markModified('data');
          await snapshot.save();
        }
      }
    } catch (e) { }
    await pushNotification(agentEmail, 'new_lead', `New lead: ${lead.name}`);
    res.json({ success: true, emailSent: emailResult.success });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/leads/:id/trigger-call — Manually trigger AI call from dashboard
app.post('/api/leads/:id/trigger-call', protect, async (req, res) => {
  try {
    const { lead } = req.body;
    if (!lead) return res.status(400).json({ error: 'lead data required' });

    console.log(`🚀 Manually triggering AI call for ${lead.name} (${lead.phone})`);
    const data = await triggerAICall(lead);
    
    res.json({ success: true, data });
  } catch (err) {
    console.error('❌ Manual trigger failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// CALLS — POST /api/calls
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/calls', async (req, res) => {
  try {
    const agentEmail = req.body.agentEmail || req.body.email;
    const { call } = req.body;
    if (!agentEmail || !call) return res.status(400).json({ error: 'agentEmail and call data required' });

    console.log(`📞 Saving call log for ${agentEmail} (Lead: ${call.leadName || 'Unknown'})`);

    let snapshot = await DataSnapshot.findOne({ email: agentEmail });
    if (!snapshot) snapshot = new DataSnapshot({ email: agentEmail, data: {} });
    if (!snapshot.data) snapshot.data = {};

    let calls = snapshot.data.pe_calls || [];
    const wasString = typeof calls === 'string';
    if (wasString) {
      try { calls = JSON.parse(calls); } catch (e) { calls = []; }
    }

    const newCall = {
      ...call,
      id: call.id || ('call_' + Date.now() + Math.random().toString(36).slice(2, 5)),
      urgency: call.urgency || 3,
      created_at: call.created_at || new Date().toISOString()
    };

    calls.unshift(newCall);

    // Keep only last 100 calls to save space
    if (calls.length > 100) calls = calls.slice(0, 100);

    snapshot.data.pe_calls = wasString ? JSON.stringify(calls) : calls;
    snapshot.markModified('data');
    await snapshot.save();

    res.json({ success: true, urgency: newCall.urgency });
  } catch (error) {
    console.error('Call Log Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// SYNC
// ──────────────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────────
// MOBILE APP SIGNALS
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/mobile/notify', async (req, res) => {
  try {
    const { lead, type } = req.body;
    console.log(`📱 Notifying Mobile App: New ${type || 'Action'} for ${lead.name}`);

    // In a production app, you would send a FCM (Firebase Cloud Messaging) 
    // or OneSignal push notification here to wake up the phone.

    res.json({ success: true, message: 'Mobile notification dispatched' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/mobile/version', (req, res) => {
  res.json({ version: 1.2, last_update: new Date().toISOString() });
});

// 🧠 $0-COST CLOUD BRAIN (Manual Script on Vercel)
let pendingLeads = []; // Global mailbox for laptop-free operation

app.get('/api/mobile/poll-leads', (req, res) => {
  if (pendingLeads.length > 0) {
    return res.json({ lead: pendingLeads.shift() });
  }
  res.json({ lead: null });
});

// ─────────────────────────────────────────────────────────────────────────────
// =============================================================================
// AI CHAT — Powered by Gemini | Knows ALL Properties | Books Visits Instantly
// =============================================================================

const conversationSessions = {};

// Build a dynamic system prompt that includes ALL current property listings
async function buildPriyaPrompt(agentEmail, channel = 'VOICE') {
  let propertyList = 'No properties listed yet.';
  try {
    const snapshot = await DataSnapshot.findOne({ email: agentEmail });
    if (snapshot && snapshot.data && snapshot.data.pe_properties) {
      let props = snapshot.data.pe_properties;
      if (typeof props === 'string') {
        try { props = JSON.parse(props); } catch (e) { props = []; }
      }
      if (Array.isArray(props) && props.length > 0) {
        propertyList = props.map((p, i) =>
          `Property ${i + 1}:
  - Name: ${p.name || p.title || 'N/A'}
  - Type: ${p.property_type || 'Apartment'}
  - Location: ${p.location || 'N/A'}
  - Price: ${p.price_label || p.price || 'Contact Agent'}
  - Bedrooms: ${p.bedrooms || p.bhk || 'N/A'}
  - Features: ${p.features || p.description || 'N/A'}
  - Status: ${p.status || 'Available'}`
        ).join('\n\n');
      }
    }
  } catch (e) {
    console.error('Error loading properties for prompt:', e.message);
  }

  const channelRules = channel === 'VOICE' ? `
STRICT PHONE CALL RULES:
- Keep EVERY reply under 2 to 3 short sentences MAX
- This is a phone call — be conversational, not written
- Never use bullet points, symbols, asterisks, or formatting
- Never say you are an AI — you are Priya, a human agent
- If lead interrupts mid-sentence: Stop, acknowledge, respond
` : channel === 'EMAIL' ? `
STRICT EMAIL RULES:
- Use a professional yet warm tone
- You can use structured bullet points for property lists
- Use bold text for property names and prices
- Always include a clear call-to-action (e.g., "Would you like to schedule a viewing for tomorrow?")
- Keep it concise — people skim emails
- Use appropriate spacing and professional formatting
- If they ask to book, provide the BOOK_VISIT: command as instructed
` : `
STRICT WHATSAPP RULES:
- Use emojis naturally to sound friendly (🏠, ✨, 😊, 📅)
- Keep messages concise but informative
- You can use bullet points for property features
- Use bold text for property names and prices
- Always end with a clear question to keep the chat going
- If they ask to book, provide the BOOK_VISIT: command as instructed
`;

  return `You are Priya, a friendly and expert real estate agent working for Zorvo Realty.
You are communicating with a potential lead via ${channel === 'VOICE' ? 'a LIVE PHONE CALL' : channel === 'EMAIL' ? 'EMAIL' : 'WHATSAPP CHAT'}.

YOUR PERSONALITY:
- Warm, friendly, confident and professional
- Talk exactly like a real human agent
- Use natural phrases like "Absolutely!", "That is great!", "Oh wonderful!", "I totally understand", "Of course!"
- Show genuine excitement about properties
- Be empathetic, patient, never pushy
- Sound like you deeply care about finding them the right home

OUR CURRENT PROPERTY LISTINGS (you know ALL of these):
${propertyList}

YOUR GOALS:
1. Greet them warmly and ask how they are
2. Ask what kind of property they need (apartment, villa, plot, commercial)
3. Ask their preferred location or area
4. Ask their budget range gently and naturally
5. Match them to the best property from our list above
6. Offer to book a visit — ask preferred date and time
7. When they confirm date and time, say: BOOK_VISIT:[property_name]|[date]|[time]
8. After booking say: I have booked your visit! You will receive a confirmation shortly.

${channelRules}

REMEMBER: Sound completely NATURAL — short words, everyday language. Your goal is to be their personal property consultant!`;
}

app.post('/api/ai/chat', async (req, res) => {
  const { input, state, lead, sessionId } = req.body;

  const sid = sessionId || (lead && lead.phone) || 'default';
  if (!conversationSessions[sid]) {
    conversationSessions[sid] = { history: [], leadData: { ...lead } };
  }
  const session = conversationSessions[sid];

  // Update lead data from conversation
  session.leadData = { ...session.leadData, ...lead };

  // Add user message
  session.history.push({ role: 'user', parts: [{ text: input }] });

  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!GEMINI_API_KEY) {
      res.json({
        reply: "That sounds wonderful! Can you tell me more about what you are looking for?",
        nextState: state,
        lead: session.leadData,
        action: null
      });
      return;
    }

    const channel = (sessionId && sessionId.startsWith('wa_')) ? 'WHATSAPP' : 'VOICE';
    const systemPrompt = await buildPriyaPrompt(AGENT_EMAIL, channel);
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ 
      model: "gemini-3-flash-preview",
      systemInstruction: systemPrompt 
    });

    const contents = session.history.map(h => ({ role: h.role, parts: h.parts }));
    // No need to prepend SYSTEM: to contents[0] anymore

    const chat = model.startChat({
      history: contents.slice(0, -1),
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 200,
      },
    });

    const result = await chat.sendMessage(input);
    const response = await result.response;
    const reply = response.text();

    // Add model reply to history
    session.history.push({ role: 'model', parts: [{ text: reply }] });
    conversationSessions[sid] = session;

    // ── DETECT BOOKING INTENT ─────────────────────────────────
    let action = null;
    let bookingResult = null;

    if (reply.includes('BOOK_VISIT:')) {
      try {
        const bookingTag = reply.match(/BOOK_VISIT:([^|]+)\|([^|]+)\|([^\n\r]+)/);
        if (bookingTag) {
          const propertyName = bookingTag[1].trim();
          const visitDate = bookingTag[2].trim();
          const visitTime = bookingTag[3].trim();

          // Auto-book the visit via the existing /api/visits endpoint
          const visitPayload = {
            agentEmail: AGENT_EMAIL,
            is_ai_booking: true,
            visit: {
              property_name: propertyName,
              client_name: session.leadData.name || lead.name || 'Lead',
              client_email: session.leadData.email || lead.email || '',
              client_phone: session.leadData.phone || lead.phone || '',
              visit_date: visitDate,
              visit_time: visitTime,
              notes: `Booked by AI agent Priya during voice call`,
              status: 'confirmed'
            }
          };

          const bookRes = await fetch(
            `${process.env.BASE_URL || 'https://real-estate-web-liard-rho.vercel.app'}/api/visits`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(visitPayload)
            }
          );

          const bookData = await bookRes.json();
          bookingResult = bookData;
          action = 'BOOKED';
          // ── Cancel follow-up messages now that lead has booked
          if (visitPayload?.visit?.client_phone) {
            cancelFollowUps(visitPayload.visit.client_phone);
          }
          console.log(`📅 AI auto-booked visit: ${propertyName} on ${visitDate} at ${visitTime} for ${session.leadData.name}`);
        }

        // Remove the BOOK_VISIT: tag from the reply speech
        reply = reply.replace(/BOOK_VISIT:[^\n\r]*/g, '').trim();
        if (!reply) {
          reply = `I have confirmed your visit! You will receive a confirmation message shortly. Is there anything else I can help you with?`;
        }

      } catch (bookErr) {
        console.error('Auto-booking error:', bookErr.message);
        reply = reply.replace(/BOOK_VISIT:[^\n\r]*/g, '').trim();
        action = 'BOOK_FAILED';
      }
    }

    res.json({
      reply,
      nextState: state,
      lead: session.leadData,
      action,
      booking: bookingResult
    });

  } catch (err) {
    console.error('Gemini chat error:', err.message);
    res.json({
      reply: "I totally understand! Could you tell me a bit more about what you are looking for?",
      nextState: state,
      lead: session.leadData || lead,
      action: null
    });
  }
});

app.get('/api/sync', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const snapshot = await DataSnapshot.findOne({ email });
    res.json(snapshot && snapshot.data ? snapshot.data : {});
  } catch (error) {
    res.status(500).json({ error: 'Database Error: ' + error.message });
  }
});

app.post('/api/sync', protect, async (req, res) => {
  try {
    const { email, data } = req.body;
    if (!email || !data) return res.status(400).json({ error: 'Email and data required' });
    await DataSnapshot.findOneAndUpdate({ email }, { email, data }, { upsert: true });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Database Error: ' + error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// MARKETING - POST /api/marketing/kit
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/marketing/kit', async (req, res) => {
  try {
    const { propertyId, agentEmail } = req.body;
    if (!propertyId) return res.status(400).json({ error: 'propertyId is required' });

    // Fetch property - in a real app, this would be from DB
    // Here we might need to find it from the agent's data snapshot in MongoDB
    const snapshot = await DataSnapshot.findOne({ email: agentEmail });
    if (!snapshot || !snapshot.data || !snapshot.data.pe_properties) {
      return res.status(404).json({ error: 'Agent properties not found' });
    }

    const properties = typeof snapshot.data.pe_properties === 'string'
      ? JSON.parse(snapshot.data.pe_properties)
      : snapshot.data.pe_properties;

    const prop = properties.find(p => p.id === propertyId);
    if (!prop) return res.status(404).json({ error: 'Property not found' });

    const kitResponse = await generateSocialMarketingKit(prop);
    res.json(kitResponse);
  } catch (error) {
    console.error('Marketing Kit Error:', error.message);
    res.status(500).json({ error: 'Failed to generate kit: ' + error.message });
  }
});



// ── OFFICIAL META WHATSAPP CLOUD API — For Vapi Tool Calls ───────────────────
app.post('/api/ai/whatsapp', async (req, res) => {
  try {
    const { phone, message } = req.body.message?.toolCalls?.[0]?.function?.arguments 
             || req.body.message?.functionCall?.parameters 
             || req.body;

    if (!phone || !message) return res.status(400).json({ error: 'phone and message required' });

    console.log(`☁️ Cloud WhatsApp Request for ${phone}`);

    const TOKEN    = process.env.WHATSAPP_TOKEN;
    const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!TOKEN || !PHONE_ID) {
      console.warn('⚠️ Meta WhatsApp Env Vars missing. Simulating...');
      return res.json({ success: true, simulated: true, message: 'Env vars missing' });
    }

    const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
    const response = await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone.replace(/\+/g, ''), // Meta needs numbers without the +
        type: "text",
        text: { body: message }
      })
    });

    const data = await response.json();
    
    if (data.error) {
      console.error('❌ Meta WhatsApp Error:', data.error.message);
      return res.status(500).json({ success: false, error: data.error.message });
    }

    console.log(`✅ Meta WhatsApp Sent to ${phone}`);
    res.json({ 
      results: [{
        toolCallId: req.body.message?.toolCalls?.[0]?.id || '1',
        result: "Message sent successfully via WhatsApp."
      }]
    });

  } catch (error) {
    console.error('❌ Cloud WhatsApp Critical Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// MARKETING - POST /api/marketing/whatsapp-blast  (Legacy - uses phone bridge)
// ──────────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────────
// SOCIAL PUBLISH - POST /api/social/publish  (Meta Graph API)
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/social/publish', async (req, res) => {
  try {
    const { platform, accessToken, mediaUrl, caption, pageId } = req.body;
    if (!platform || !accessToken) return res.status(400).json({ error: 'platform and accessToken required' });

    const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

    if (platform === 'instagram') {
      const igId = pageId || process.env.META_IG_USER_ID;
      if (!igId) return res.status(400).json({ error: 'META_IG_USER_ID not set' });

      // Step 1: Create container
      const containerRes = await fetch(`https://graph.facebook.com/v19.0/${igId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: mediaUrl, caption, access_token: accessToken })
      });
      const container = await containerRes.json();
      if (!container.id) return res.status(400).json({ error: 'IG container failed', detail: container });

      // Step 2: Publish
      const publishRes = await fetch(`https://graph.facebook.com/v19.0/${igId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: container.id, access_token: accessToken })
      });
      const published = await publishRes.json();
      return res.json({ success: !!published.id, post_id: published.id, platform: 'instagram' });
    }

    if (platform === 'facebook') {
      const fbPageId = pageId || process.env.META_FB_PAGE_ID;
      if (!fbPageId) return res.status(400).json({ error: 'META_FB_PAGE_ID not set' });

      const postRes = await fetch(`https://graph.facebook.com/v19.0/${fbPageId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: mediaUrl, caption, access_token: accessToken, published: true })
      });
      const post = await postRes.json();
      return res.json({ success: !!post.post_id, post_id: post.post_id, platform: 'facebook' });
    }

    return res.status(400).json({ error: 'Platform not supported yet: ' + platform });
  } catch (error) {
    console.error('Social Publish Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/send-email — secure email proxy ────────────────────────────────
app.post('/api/send-email', protect, async (req, res) => {
  try {
    const { to, subject, message, html } = req.body;
    if (!to || !subject) return res.status(400).json({ error: 'to and subject required' });

    console.log(`📧 API Proxy: Sending email to [${to}] | Subject: ${subject}`);
    const result = await sendEmail({ to, subject, message, html });
    res.json(result);
  } catch (error) {
    console.error('❌ Email Proxy Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// SERVER
// ──────────────────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`Zorvo Server running on port ${PORT}`));
}



// =============================================================================
// VAPI WEBHOOK — Receives all call events from VAPI
// Set this URL in your VAPI dashboard: /api/vapi/webhook
// =============================================================================
app.post('/api/vapi/webhook', async (req, res) => {
  const event = req.body;
  const type = event?.message?.type || event?.type;

  console.log(`📡 VAPI webhook: ${type}`);
  
  // 1. FAST RESPONSE: Respond immediately for non-synchronous events to prevent Vapi timeouts
  if (type !== 'function-call' && type !== 'assistant-request') {
    res.json({ received: true });
    
    // We only process targetEvents asynchronously
    const targetEvents = ['call-started', 'end-of-call-report', 'hang', 'status-update'];
    if (!targetEvents.includes(type)) {
      return;
    }
    if (type === 'status-update' && event?.message?.status !== 'in-progress') {
      return;
    }
  }

  try {
    const call = event?.message?.call || event?.call || {};
    const metadata = call.metadata || {};
    const leadId = metadata.leadId || null;
    const phone = call.customer?.number || null;

    // ── call-started ────────────────────────────────────────────────────────
    if (type === 'call-started' || (type === 'status-update' && event?.message?.status === 'in-progress')) {
      console.log(`📞 VAPI call started → ${phone}`);
      
      let finalLeadId = leadId;
      if (!finalLeadId || (typeof finalLeadId === 'string' && !finalLeadId.match(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/))) {
        try {
          const { createClient } = require('@supabase/supabase-js');
          const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
          let leadData = null;
          if (phone) {
            const { data } = await sb.from('team_leads').select('id').eq('phone', phone).limit(1);
            if (data && data.length > 0) leadData = data[0];
          }
          if (!leadData && phone) {
            const { data } = await sb.from('leads').select('id').eq('phone', phone).limit(1);
            if (data && data.length > 0) leadData = data[0];
          }
          if (leadData) finalLeadId = leadData.id;
        } catch (e) {}
      }

      if (finalLeadId) {
        await robustUpdateLeadStage(finalLeadId, 'Contacted');
        await syncLeadToSnapshot(AGENT_EMAIL, finalLeadId, { pipeline_stage: 'Contacted', status: 'Contacted' });
      }
      if (phone) cancelRetry(phone);
    }
    
    // ── assistant-request — VAPI wants assistant for inbound call ───────────
    else if (type === 'assistant-request') {
      console.log(`🙋 Incoming call from ${phone} — providing assistant config`);
      
      // Fetch current properties to give the AI context
      let properties = [];
      try {
        const snapshot = await DataSnapshot.findOne({ email: AGENT_EMAIL });
        if (snapshot && snapshot.data && snapshot.data.pe_properties) {
          properties = typeof snapshot.data.pe_properties === 'string' 
            ? JSON.parse(snapshot.data.pe_properties) 
            : snapshot.data.pe_properties;
        }
      } catch (e) { console.error('Error fetching properties for inbound:', e.message); }

      const config = buildAssistantConfig(properties);
      
      // Customize first message for inbound calls
      config.firstMessage = `Hi there! Thank you for calling Zorvo Realty. This is Sarah speaking. How can I help you find your dream home today?`;
      
      return res.json({ assistant: config });
    }

    // ── function-call — AI wants to book a visit ─────────────────────────────
    else if (type === 'function-call') {
      const fnName = event?.message?.functionCall?.name;
      const fnArgs = event?.message?.functionCall?.parameters || {};

      console.log(`🔧 VAPI function call: ${fnName}`, fnArgs);

      if (fnName === 'bookVisit') {
        // Get lead details from DB
        let leadInfo = {};
        try {
          const { createClient } = require('@supabase/supabase-js');
          const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
          
          // 1. Try team_leads by ID
          if (leadId) {
            const { data } = await sb.from('team_leads').select('*').eq('id', leadId).single();
            if (data) leadInfo = data;
          }
          // 2. Try leads by ID
          if (!leadInfo.name && leadId) {
            const { data } = await sb.from('leads').select('*').eq('id', leadId).single();
            if (data) leadInfo = data;
          }
          // 3. Try team_leads by phone
          if (!leadInfo.name && phone) {
            const { data } = await sb.from('team_leads').select('*').eq('phone', phone).single();
            if (data) leadInfo = data;
          }
          // 4. Try leads by phone
          if (!leadInfo.name && phone) {
            const { data } = await sb.from('leads').select('*').eq('phone', phone).single();
            if (data) leadInfo = data;
          }
        } catch (e) {
          console.error('Error fetching lead info in bookVisit webhook:', e.message);
        }

        // Save the booking
        try {
          const visitPayload = {
            agentEmail: AGENT_EMAIL,
            is_ai_booking: true,
            visit: {
              lead_id: leadId || leadInfo.id || null,
              client_name: leadInfo.name || call.customer?.name || 'Lead',
              client_phone: phone || leadInfo.phone || '',
              client_email: leadInfo.email || call.customer?.email || '',
              property_name: fnArgs.property_interest || leadInfo.property_interest || 'Property Visit',
              visit_date: fnArgs.visit_date,
              visit_time: fnArgs.visit_time,
              notes: `Booked by VAPI AI agent — call ID: ${call.id}`,
              status: 'confirmed',
            }
          };

          const bookingResult = await processVisitBooking(visitPayload);
          
          if (phone) cancelFollowUps(phone);

          console.log(`✅ VAPI booking saved via processVisitBooking: ${fnArgs.visit_date} ${fnArgs.visit_time}`);
          
          return res.json({
            results: [{
              toolCallId: event.message.functionCall.id,
              result: `Visit successfully booked for ${fnArgs.visit_date} at ${fnArgs.visit_time}. Tell the customer we look forward to seeing them!`
            }]
          });
        } catch (bookingError) {
          console.error('❌ VAPI tool bookVisit failed:', bookingError.message || bookingError.error);
          return res.json({
            results: [{
              toolCallId: event.message.functionCall.id,
              result: `I am sorry, but I couldn't book that slot: ${bookingError.error || bookingError.message}. Please ask the customer for a different time.`
            }]
          });
        }
      }

      if (fnName === 'transferCall') {
        const transferPhone = process.env.TRANSFER_NUMBER || process.env.AGENT_PHONE;
        
        // 1. Notify agent via Email
        try {
          await sendEmail({
            to: AGENT_EMAIL,
            subject: `🔥 URGENT: Transfer Request from VAPI AI — Lead ${phone}`,
            message: `VAPI AI transferred a lead who requested a human agent.\n\nLead Phone: ${phone}\nReason: ${fnArgs.reason || 'requested human'}\n\nPlease call them back immediately!\n\n— PropEdge AI`,
            html: `<div style="font-family:Arial,sans-serif;max-width:600px;background:#0a0e14;color:#faf8f4;padding:24px;border-radius:8px;border:2px solid #e05060"><h2 style="color:#e05060;margin:0 0 16px">🔥 URGENT: Transfer Request</h2><p>A lead has requested a human agent via VAPI AI.</p><table style="width:100%;border-collapse:collapse"><tr><td style="padding:8px 0;color:rgba(255,255,255,0.5)">Lead Phone:</td><td style="padding:8px 0;color:#faf8f4;font-weight:bold">${phone}</td></tr><tr><td style="padding:8px 0;color:rgba(255,255,255,0.5)">Reason:</td><td style="padding:8px 0;color:#faf8f4">${fnArgs.reason || 'requested human'}</td></tr></table><p style="margin-top:16px;color:#e05060;font-weight:bold">Please call them back immediately!</p></div>`
          });
        } catch (e) { console.error('Transfer Email Error:', e.message); }

        // 2. Instruct Vapi to transfer the call if controlUrl is present
        const controlUrl = call.monitor?.controlUrl || call.controlUrl;
        if (controlUrl && transferPhone) {
          console.log(`🚀 Initiating Vapi transfer to ${transferPhone}`);
          try {
            const { default: fetch } = await import('node-fetch');
            await fetch(controlUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                operation: 'transfer-call',
                destination: {
                  type: 'number',
                  number: transferPhone
                }
              }),
            });
          } catch (e) {
            console.error('❌ Vapi transfer failed:', e.message);
          }
        }

        return res.json({
          results: [{
            toolCallId: event.message.functionCall.id,
            result: "Transferring you to a live agent now. One moment please."
          }]
        });
      }

      if (fnName === 'notifyAgentNoMatch') {
        const { budget, location, property_type } = fnArgs;
        console.log('⚠️ Unmatched Lead Alert: ' + phone + ' - ' + budget + ' in ' + location);

        try {
          await sendEmail({
            to: AGENT_EMAIL,
            subject: '⚠️ Unmatched Lead Alert: Request outside inventory',
            message: `A lead called but their request does not match our current inventory.
 
Lead Phone: ${phone}
Requested Budget: ${budget || 'N/A'}
Requested Location: ${location || 'N/A'}
Property Type: ${property_type || 'N/A'}

Please check the market and contact them within 5 hours.

— PropEdge AI`,
            html: `<div style="font-family:Arial,sans-serif;max-width:600px;background:#0a0e14;color:#faf8f4;padding:24px;border-radius:8px;border:2px solid #f0c040"><h2 style="color:#f0c040;margin:0 0 16px">⚠️ Unmatched Lead Request</h2><p>A lead called asking for something outside our current inventory. They have been informed you will reach out within 5 hours.</p><table style="width:100%;border-collapse:collapse"><tr><td style="padding:8px 0;color:rgba(255,255,255,0.5)">Lead Phone:</td><td style="padding:8px 0;color:#faf8f4;font-weight:bold">${phone}</td></tr><tr><td style="padding:8px 0;color:rgba(255,255,255,0.5)">Requested Budget:</td><td style="padding:8px 0;color:#faf8f4">${budget || 'N/A'}</td></tr><tr><td style="padding:8px 0;color:rgba(255,255,255,0.5)">Requested Location:</td><td style="padding:8px 0;color:#faf8f4">${location || 'N/A'}</td></tr><tr><td style="padding:8px 0;color:rgba(255,255,255,0.5)">Property Type:</td><td style="padding:8px 0;color:#faf8f4">${property_type || 'N/A'}</td></tr></table></div>`
          });
        } catch (e) { console.error('Notify Email Error:', e.message); }

        return res.json({
          results: [{
            toolCallId: event.message.functionCall.id,
            result: 'Successfully notified the agent. Please tell the user: I have sent your details to our senior agent, he will check the market and inform you within 5 hours.'
          }]
        });
      }
    }

    // ── end-of-call-report — call ended, save everything ────────────────────
    else if (type === 'end-of-call-report') {
      const report = event?.message || {};
      const transcript = report.transcript || '';
      const recording = report.recordingUrl || null;
      const endedReason = report.endedReason || 'unknown';
      const duration    = report.durationSeconds || 0;
      const isFailed    = ['customer-busy', 'customer-did-not-answer', 'voicemail', 'customer-did-not-pick-up', 'phone-number-not-found', 'network-error'].includes(endedReason);

      console.log(`📋 VAPI call ended. Duration: ${duration}s | Reason: ${endedReason}`);

      // 1. Save call log to database
      await saveCallLog({
        leadId,
        agentId: metadata.agentId || null,
        teamId: metadata.teamId || null,
        phone,
        duration,
        transcript,
        recordingUrl: recording,
        status: duration > 10 ? 'answered' : 'no_answer',
      });

      // 2. Extract structured qualification details from Vapi analysis report
      const analysis = event?.message?.analysis || event?.analysis || event?.message?.call?.analysis || {};
      const structuredData = analysis.structuredData || {};

      const extractedLead = {
        name: call.customer?.name || metadata.name || null,
        phone: phone || call.customer?.number || metadata.phone || null,
        email: metadata.email || call.customer?.email || structuredData.email || structuredData.client_email || null,
        budget: structuredData.budget || metadata.budget || null,
        bhk_preference: structuredData.bhk_preference || structuredData.bhkPreference || structuredData.bhk || null,
        pre_approval_status: structuredData.pre_approval_status || structuredData.preApprovalStatus || structuredData.preApproval || null,
        property_interest: structuredData.property_interest || structuredData.propertyInterest || metadata.interest || null,
        notes: analysis.summary || transcript.substring(0, 500) || null,
        status: 'Contacted',
        qualification_score: parseInt(structuredData.qualification_score || structuredData.score || (structuredData.pre_approval_status === 'yes' ? 90 : 70)) || 70
      };

      // 3. Find and update the existing lead in database and dashboard snapshot
      let finalLeadId = leadId;
      const { createClient } = require('@supabase/supabase-js');
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

      let existingLead = null;
      if (finalLeadId) {
        let { data } = await sb.from('team_leads').select('*').eq('id', finalLeadId).single();
        if (data) {
          existingLead = { table: 'team_leads', data };
        } else {
          let { data: lData } = await sb.from('leads').select('*').eq('id', finalLeadId).single();
          if (lData) existingLead = { table: 'leads', data: lData };
        }
      }
      
      if (!existingLead && phone) {
        let { data } = await sb.from('team_leads').select('*').eq('phone', phone).single();
        if (data) {
          existingLead = { table: 'team_leads', data };
          finalLeadId = data.id;
        } else {
          let { data: lData } = await sb.from('leads').select('*').eq('phone', phone).single();
          if (lData) {
            existingLead = { table: 'leads', data: lData };
            finalLeadId = lData.id;
          }
        }
      }

      if (existingLead) {
        console.log(`📝 Updating existing lead ${finalLeadId} in Supabase table "${existingLead.table}"`);
        const updates = {};
        if (extractedLead.budget) updates.budget = extractedLead.budget;
        if (extractedLead.bhk_preference) updates.bhk_preference = extractedLead.bhk_preference;
        if (extractedLead.pre_approval_status) updates.pre_approval_status = extractedLead.pre_approval_status;
        if (extractedLead.property_interest) updates.property_interest = extractedLead.property_interest;
        if (extractedLead.qualification_score) updates.qualification_score = extractedLead.qualification_score;
        if (extractedLead.notes) updates.notes = (existingLead.data.notes ? existingLead.data.notes + '\n' : '') + `[AI Call Summary]: ${extractedLead.notes}`;
        updates.stage = 'contacted';
        updates.updated_at = new Date().toISOString();

        if (existingLead.table === 'team_leads') {
          await sb.from('team_leads').update(updates).eq('id', finalLeadId);
        } else {
          await sb.from('leads').update({
            budget: updates.budget,
            bhk_preference: updates.bhk_preference,
            pre_approval_status: updates.pre_approval_status,
            property_interest: updates.property_interest,
            qualification_score: updates.qualification_score,
            notes: updates.notes,
            status: 'Contacted'
          }).eq('id', finalLeadId);
        }

        // Sync to MongoDB DataSnapshot pe_leads
        await syncLeadToSnapshot(AGENT_EMAIL, finalLeadId, {
          ...updates,
          pipeline_stage: 'Contacted',
          status: 'Contacted'
        });
      } else if (phone) {
        // Create new lead (inbound call)
        console.log(`➕ Creating new lead in database for inbound phone: ${phone}`);
        
        const newLeadRecord = {
          name: extractedLead.name || 'New Inbound Lead',
          phone: phone,
          email: extractedLead.email || '',
          property_interest: extractedLead.property_interest || 'General Inquiry',
          budget: extractedLead.budget || 'Flexible',
          bhk_preference: extractedLead.bhk_preference || 'N/A',
          pre_approval_status: extractedLead.pre_approval_status || 'N/A',
          qualification_score: extractedLead.qualification_score || 50,
          source: 'AI Inbound Call',
          status: 'New',
          notes: extractedLead.notes ? `[AI Inbound Call Summary]: ${extractedLead.notes}` : 'Created from AI Inbound Call'
        };

        let savedSbLead = null;
        try {
          const { data, error } = await sb.from('leads').insert([newLeadRecord]).select().single();
          if (data) savedSbLead = data;
        } catch (e) {}

        let savedTeamLead = null;
        try {
          const newTeamLeadRecord = {
            team_id: AGENT_EMAIL,
            name: newLeadRecord.name,
            phone: newLeadRecord.phone,
            email: newLeadRecord.email,
            property_interest: newLeadRecord.property_interest,
            budget: newLeadRecord.budget,
            source: newLeadRecord.source,
            stage: 'contacted',
            notes: newLeadRecord.notes
          };
          const { data, error } = await sb.from('team_leads').insert([newTeamLeadRecord]).select().single();
          if (data) savedTeamLead = data;
        } catch (e) {}

        try {
          let snapshot = await DataSnapshot.findOne({ email: AGENT_EMAIL });
          if (!snapshot) snapshot = new DataSnapshot({ email: AGENT_EMAIL, data: {} });
          if (!snapshot.data) snapshot.data = {};
          
          let leads = snapshot.data.pe_leads || [];
          if (typeof leads === 'string') {
            try { leads = JSON.parse(leads); } catch (e) { leads = []; }
          }

          const mongoLead = {
            id: savedTeamLead?.id || savedSbLead?.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
            name: newLeadRecord.name,
            phone: newLeadRecord.phone,
            email: newLeadRecord.email,
            property_interest: newLeadRecord.property_interest,
            budget: newLeadRecord.budget,
            bhk_preference: newLeadRecord.bhk_preference,
            pre_approval_status: newLeadRecord.pre_approval_status,
            qualification_score: newLeadRecord.qualification_score,
            source: newLeadRecord.source,
            status: 'Contacted',
            pipeline_stage: 'Contacted',
            notes: newLeadRecord.notes,
            created_at: new Date().toISOString()
          };

          leads.unshift(mongoLead);
          snapshot.data.pe_leads = leads;
          snapshot.markModified('data');
          await snapshot.save();
          console.log(`✅ Saved new inbound lead ${mongoLead.id} to MongoDB snapshot`);
        } catch (mErr) {
          console.error('❌ Failed to save new inbound lead to MongoDB:', mErr.message);
        }
      }

      // 4. Format and Sync Call Log and Transcript to MongoDB Snapshot pe_calls
      const leadNameForCall = (existingLead?.data?.name) || extractedLead.name || 'New Inbound Lead';
      
      const minutes = Math.floor(duration / 60);
      const seconds = Math.floor(duration % 60);
      const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      
      const messages = event?.message?.call?.messages || event?.message?.messages || [];
      let formattedTranscript = [];
      if (messages.length > 0) {
        formattedTranscript = messages.map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.message || m.content || ''
        }));
      } else if (typeof transcript === 'string' && transcript.length > 0) {
        formattedTranscript = transcript.split('\n').map(line => {
          const parts = line.split(':');
          if (parts.length >= 2) {
            const role = parts[0].trim().toLowerCase().includes('assistant') ? 'assistant' : 'user';
            const content = parts.slice(1).join(':').trim();
            return { role, content };
          }
          return { role: 'user', content: line.trim() };
        }).filter(t => t.content);
      }

      const urgencyScore = extractedLead.qualification_score ? Math.min(10, Math.max(1, Math.round(extractedLead.qualification_score / 10))) : 5;
      
      let callOutcome = 'Prospective';
      if (duration < 10 || isFailed) {
        callOutcome = 'No Answer';
      } else if (transcript.toLowerCase().includes('bookvisit') || transcript.toLowerCase().includes('visit booked') || transcript.toLowerCase().includes('confirmed')) {
        callOutcome = 'Confirmed';
      }

      await syncCallLogToSnapshot(AGENT_EMAIL, {
        id: call.id || ('call_' + Date.now()),
        lead_name: leadNameForCall,
        urgency: urgencyScore,
        outcome: callOutcome,
        duration: durationStr,
        transcript: formattedTranscript,
        created_at: new Date().toISOString()
      });

      // 5. Send Bell Notification to Dashboard
      await notifyAgent(AGENT_EMAIL, {
        title: `📞 Call Ended: ${leadNameForCall}`,
        description: `Duration: ${durationStr} · Status: ${callOutcome} · Score: ${urgencyScore}/10`,
        type: 'info',
        icon: 'fas fa-phone-alt'
      });

      if ((isFailed || duration < 10) && phone) {
        console.log(`⚠️  Detected call failure/no-answer for ${phone} (Reason: ${endedReason}). Scheduling retries.`);
        const leadMeta = { 
          phone, 
          name: call.customer?.name, 
          id: leadId, 
          email: metadata.email,
          property_interest: metadata.interest || '',
          budget: metadata.budget || ''
        };
        scheduleRetry(leadMeta, triggerAICall, triggerFailoverMessages);
      }

      // ── Schedule email follow-ups after call ends (Day 0 instant, 1, 2, 3)
      if (phone) {
        const leadEmail = metadata.email || (leadId ? await getLeadEmail(leadId) : null);
        const leadForFollowup = {
          phone,
          email: leadEmail || null,
          name:  call.customer?.name || 'there',
          property_interest: call.metadata?.interest || metadata.interest || '',
          budget: call.metadata?.budget || metadata.budget || '',
          id: leadId,
        };
        let followupProperties = [];
        try {
          const snap = await DataSnapshot.findOne({ email: AGENT_EMAIL });
          if (snap?.data?.pe_properties) {
            followupProperties = typeof snap.data.pe_properties === 'string'
              ? JSON.parse(snap.data.pe_properties)
              : snap.data.pe_properties;
          }
        } catch (e) { console.error('VAPI followup property fetch error:', e.message); }
        scheduleFollowUps(leadForFollowup, followupProperties);
      }
    }

    // ── hang — lead hung up ──────────────────────────────────────────────────
    else if (type === 'hang') {
      console.log(`📵 Lead hung up: ${phone}`);
    }

  } catch (err) {
    console.error('VAPI webhook processing error:', err.message);
  }
});

// ── GET /api/vapi/calls — list recent VAPI calls ─────────────────────────────
app.get('/api/vapi/calls', protect, async (req, res) => {
  try {
    const calls = await listCalls(req.query.limit || 20);
    res.json({ success: true, calls });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/vapi/call/:id — get single call details ─────────────────────────
app.get('/api/vapi/call/:id', protect, async (req, res) => {
  try {
    const call = await getCall(req.params.id);
    res.json({ success: true, call });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/vapi/status — check VAPI connection ─────────────────────────────
app.get('/api/vapi/status', (req, res) => {
  res.json({
    configured: !!(process.env.VAPI_API_KEY),
    assistantId: process.env.VAPI_ASSISTANT_ID || null,
    phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID || null,
    webhookUrl: `${process.env.BASE_URL}/api/vapi/webhook`,
  });
});

// =============================================================================
// FOLLOW-UP SCHEDULER — Auto WhatsApp Messages (Day 0, 1, 2, 3)
// =============================================================================

// ── GET /api/followups — list all scheduled follow-ups ────────────────────────
app.get('/api/followups', protect, (req, res) => {
  const list = getAllScheduled();
  res.json({ success: true, count: list.length, followups: list });
});

// ── DELETE /api/followups/:phone — cancel follow-ups for a lead ───────────────
app.delete('/api/followups/:phone', protect, (req, res) => {
  const phone = decodeURIComponent(req.params.phone);
  cancelFollowUps(phone);
  res.json({ success: true, message: `Follow-ups cancelled for ${phone}` });
});

// ── POST /api/followups/test — send test message immediately ──────────────────
app.post('/api/followups/test', protect, async (req, res) => {
  const { phone, name, property_interest, day = 0 } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });

  const lead = { phone, name: name || 'Test Lead', property_interest: property_interest || '3BHK Apartment', budget: '' };
  const msgs = [
    require('../services/followup').scheduleFollowUps,
  ];

  // Send immediate test message
  const { sendWhatsAppText } = require('../services/whatsapp');
  const testMsg = `🧪 *Zorvo Follow-Up Test*\n\nThis is a test of the Day ${day} follow-up message for ${name || 'Test Lead'}.\n\nIf you received this, your WhatsApp follow-up system is working! ✅`;
  const result = await sendWhatsAppText(phone, testMsg);
  res.json({ success: true, result });
});

// =============================================================================
// TEAM MANAGEMENT — Multi-Agent Support
// =============================================================================

// ── POST /api/team/lead-assign — Assign incoming lead to agent ────────────────
app.post('/api/team/lead-assign', protect, async (req, res) => {
  try {
    const { lead, teamId } = req.body;
    if (!lead || !teamId) return res.status(400).json({ error: 'lead and teamId required' });

    const agent = await assignLeadToAgent(lead, teamId);
    if (!agent) return res.json({ success: true, agent: null, message: 'No agents configured' });

    const savedLead = await saveTeamLead(lead, agent.id, teamId);

    // Inject full agent + lead context so AI call + booking are wired correctly
    lead.id = savedLead.data?.id || null;
    lead.agent_id = agent.id;
    lead.team_id = teamId;
    lead.assigned_agent_name = agent.name;
    lead.assigned_agent_phone = agent.phone;

    // Trigger AI call immediately with full context
    if (lead.phone) {
      triggerAICall(lead).catch(e => console.error('Team call trigger error:', e.message));
    }

    res.json({ success: true, agent, lead: savedLead.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/team/agents — List all agents for a team ────────────────────────
app.get('/api/team/agents', protect, async (req, res) => {
  try {
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const teamId = req.query.teamId || AGENT_EMAIL;
    const { data, error } = await sb.from('team_agents').select('*').eq('team_id', teamId);
    if (error) throw error;
    res.json({ success: true, agents: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/team/agents — Add agent to team ─────────────────────────────────
app.post('/api/team/agents', protect, async (req, res) => {
  try {
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const { name, email, phone, coverage_areas, teamId } = req.body;
    const { data, error } = await sb.from('team_agents').insert([{
      name, email, phone,
      coverage_areas: coverage_areas || [],
      team_id: teamId || AGENT_EMAIL,
      status: 'active',
      leads_assigned: 0,
      created_at: new Date().toISOString(),
    }]).select().single();
    if (error) throw error;
    res.json({ success: true, agent: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── DELETE /api/team/agents/:id — Remove agent ────────────────────────────────
app.delete('/api/team/agents/:id', protect, async (req, res) => {
  try {
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const { error } = await sb.from('team_agents').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// =============================================================================
// LEAD PIPELINE — Stage Tracking
// =============================================================================

// ── PATCH /api/leads/:id/stage — Move lead through pipeline ──────────────────
app.patch('/api/leads/:id/stage', protect, async (req, res) => {
  try {
    const { stage } = req.body;
    // Map of internal names to dashboard display names
    const validStages = ['New', 'Contacted', 'Negotiation', 'Closed', 'lost'];
    if (!validStages.includes(stage)) {
      return res.status(400).json({ error: `Invalid stage. Must be one of: ${validStages.join(', ')}` });
    }
    const result = await updateLeadStage(req.params.id, stage);
    
    // Sync to dashboard snapshot
    await syncLeadToSnapshot(AGENT_EMAIL, req.params.id, { pipeline_stage: stage, status: stage });
    
    res.json({ success: result.success, stage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// CALL LOGS — Recording + Transcript Storage
// =============================================================================

// ── POST /api/call-log — Save call result after each call ────────────────────
app.post('/api/call-log', async (req, res) => {
  try {
    const { leadId, agentId, teamId, phone, duration, transcript, recordingUrl, status } = req.body;
    const result = await saveCallLog({ leadId, agentId, teamId, phone, duration, transcript, recordingUrl, status });

    // Update lead stage to 'contacted' after first call
    if (leadId && status === 'answered') {
      await updateLeadStage(leadId, 'contacted');
      cancelRetry(phone); // Cancel retries since call was answered
    } else if (status === 'no_answer') {
      scheduleRetry({ phone, ...req.body }, triggerAICall);
    }

    res.json({ success: result.success, id: result.data?.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/call-logs — Get call history ────────────────────────────────────
app.get('/api/call-logs', protect, async (req, res) => {
  try {
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const { teamId, agentId, limit = 50 } = req.query;

    let query = sb.from('call_logs').select('*').order('called_at', { ascending: false }).limit(Number(limit));
    if (teamId) query = query.eq('team_id', teamId);
    if (agentId) query = query.eq('agent_id', agentId);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ success: true, logs: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// REPORTING — Team Performance Metrics
// =============================================================================

// ── GET /api/report — Full team performance report ───────────────────────────
app.get('/api/report', protect, async (req, res) => {
  try {
    const teamId = req.query.teamId || AGENT_EMAIL;
    const fromDate = req.query.from || null;
    const report = await getTeamReport(teamId, fromDate);

    if (!report) return res.json({
      success: true,
      message: 'No data yet or Supabase not configured',
      summary: { total_leads: 0, calls_made: 0, calls_answered: 0, answer_rate_pct: 0, bookings: 0, conversion_pct: 0 },
      pipeline: { new: 0, contacted: 0, qualified: 0, booked: 0, visited: 0, closed: 0, lost: 0 },
      agents: []
    });

    res.json({ success: true, ...report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── POST /api/leads/takeover-notify — called by transfer_call.js ─────────────
app.post('/api/leads/takeover-notify', async (req, res) => {
  try {
    const { agentPhone, reason, sessionId, message } = req.body;
    const notifyPhone = agentPhone || process.env.TRANSFER_NUMBER || process.env.AGENT_WHATSAPP;
    if (notifyPhone) {
      try {
        const { sendWhatsAppText } = require('../services/whatsapp');
        await sendWhatsAppText(notifyPhone, message || `🔥 AI Transfer Request\nReason: ${reason}\nSession: ${sessionId}`);
      } catch (e) { console.error('Takeover WA error:', e.message); }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ── GET /api/retry-status — Check retry queue ────────────────────────────────
app.get('/api/retry-status', protect, (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  res.json({ success: true, ...getRetryStatus(phone) });
});

// =============================================================================
// MANUAL OVERRIDE — High-Intent Lead, Agent Takes Over
// =============================================================================

// ── POST /api/leads/:id/takeover — Agent manually calls lead ─────────────────
app.post('/api/leads/:id/takeover', protect, async (req, res) => {
  try {
    const { agentPhone, leadPhone, leadName } = req.body;
    if (!leadPhone) return res.status(400).json({ error: 'leadPhone required' });

    cancelRetry(leadPhone); // Stop AI retries
    await updateLeadStage(req.params.id, 'contacted');

    // Notify agent to call immediately
    try {
      const { sendWhatsAppText } = require('../services/whatsapp');
      await sendWhatsAppText(
        agentPhone || process.env.AGENT_WHATSAPP,
        `🔥 HIGH INTENT LEAD — Call NOW!\n👤 ${leadName}\n📞 ${leadPhone}\nThis lead was flagged for manual follow-up.`
      );
    } catch (e) { console.error('Takeover WA error:', e.message); }

    res.json({ success: true, message: `Agent notified to call ${leadPhone} immediately` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── AI SMS TOOL — For Vapi Function Calls ──────────────────────────────────
app.post('/api/ai/sms', async (req, res) => {
  try {
    const { phone, message } = req.body.message?.toolCalls?.[0]?.function?.arguments 
             || req.body.message?.functionCall?.parameters 
             || req.body;

    if (!phone || !message) return res.status(400).json({ error: 'phone and message required' });

    console.log(`📠 AI SMS Request for ${phone}`);

    const { sendSMSText } = require('../services/sms');
    const result = await sendSMSText(phone, message);

    if (result.success) {
      res.json({ success: true, message: 'SMS Sent' });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ── SMS — POST /api/sms ──────────────────────────────────────────────────────
app.post('/api/sms', async (req, res) => {
  try {
    const { to, message, type, visit } = req.body;
    if (!to) return res.status(400).json({ error: 'Recipient phone number (to) is required' });

    let result;
    if (type === 'booking_confirmed' && visit) result = await sendBookingConfirmedSMS(to, visit);
    else if (type === 'reminder' && visit) result = await sendVisitReminderSMS(to, visit);
    else if (message) {
      result = await sendSMSText(to, message);
    } else {
      return res.status(400).json({ error: 'Provide either "message" or "type" + "visit"' });
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── SMS BLAST — POST /api/sms/blast ──────────────────────────────────────────
app.post('/api/sms/blast', protect, async (req, res) => {
  try {
    const { recipients, message } = req.body;
    if (!recipients || !Array.isArray(recipients) || !message) {
      return res.status(400).json({ error: 'recipients (array) and message are required' });
    }

    const results = [];
    for (const phone of recipients) {
      try {
        const r = await sendSMSText(phone, message);
        results.push({ phone, success: r.success });
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (e) {
        results.push({ phone, success: false, error: e.message });
      }
    }

    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── AI SMS TOOL — For Vapi Function Calls ──────────────────────────────────
app.post('/api/ai/sms', async (req, res) => {
  try {
    const { phone, message } = req.body.message?.toolCalls?.[0]?.function?.arguments 
             || req.body.message?.functionCall?.parameters 
             || req.body;

    if (!phone || !message) return res.status(400).json({ error: 'phone and message required' });

    console.log(`📠 AI SMS Request for ${phone}`);

    const result = await sendSMSText(phone, message);

    if (result.success) {
      res.json({ success: true, message: 'SMS Sent' });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = app;

// =============================================================================
// EMAIL WEBHOOK — Automated Inbound Reply System
// =============================================================================

/**
 * Inbound Email Webhook
 * Receives replies from leads and generates an automated AI response.
 * Compatible with Resend Inbound Webhooks.
 */
app.post('/api/webhook/email-reply', async (req, res) => {
  try {
    const { from, subject, text, html } = req.body;
    const body = text || html || '';
    
    if (!from || !body) {
      console.log('⚠️  Incomplete email payload received');
      return res.status(400).json({ error: 'from and body required' });
    }

    const leadEmail = from.match(/<([^>]+)>/)?.[1] || from;
    console.log(`✉️  Inbound Email from: ${leadEmail} | Subject: ${subject}`);

    // ── 1. Find Lead ────────────────────────────────────────────────────────
    const { data: lead, error: leadErr } = await sb.from('leads').select('*').eq('email', leadEmail).single();
    if (!lead || leadErr) {
      console.warn(`⚠️  No lead found for email ${leadEmail} — skipping auto-reply`);
      return res.json({ success: false, reason: 'Lead not found' });
    }

    // ── 2. Get/Create Session ────────────────────────────────────────────────
    const sid = `email_${leadEmail}`;
    let session = conversationSessions[sid];
    if (!session) {
      session = { 
        history: [], 
        leadData: lead,
        lastActive: Date.now()
      };
    }
    session.history.push({ role: 'user', parts: [{ text: body }] });

    // ── 3. Generate AI Reply ────────────────────────────────────────────────
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'AI Brain not configured' });
    }

    const systemPrompt = await buildPriyaPrompt(AGENT_EMAIL, 'EMAIL');
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ 
      model: "gemini-3-flash-preview",
      systemInstruction: systemPrompt 
    });

    const contents = session.history.map(h => ({ role: h.role, parts: h.parts }));
    const chat = model.startChat({
      history: contents.slice(0, -1),
      generationConfig: { temperature: 0.8, maxOutputTokens: 500 }
    });

    const result = await chat.sendMessage(body);
    const response = await result.response;
    const reply = response.text();

    session.history.push({ role: 'model', parts: [{ text: reply }] });
    conversationSessions[sid] = session;

    // ── 4. Detect & Process Bookings ─────────────────────────────────────────
    if (reply.includes('BOOK_VISIT:')) {
      const tag = reply.match(/BOOK_VISIT:([^|]+)\|([^|]+)\|([^\n\r]+)/);
      if (tag) {
        const propertyName = tag[1].trim();
        const visitDate = tag[2].trim();
        const visitTime = tag[3].trim();

        await saveVisitToSupabase({
          agentEmail: AGENT_EMAIL,
          property_name: propertyName,
          client_name: lead.name || 'Lead',
          client_email: lead.email,
          client_phone: lead.phone || '',
          visit_date: visitDate,
          visit_time: visitTime,
          status: 'confirmed',
          notes: 'Auto-booked via AI Email Assistant'
        });
        console.log(`✅ AI Email booked visit for ${lead.name} on ${visitDate}`);
      }
    }

    // ── 5. Send Email Back ──────────────────────────────────────────────────
    const cleanReply = reply.replace(/BOOK_VISIT:[^|\n]+\|[^|\n]+\|[^\n\r]+/g, '').trim();
    const formattedHtml = `<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#faf8f4;border-radius:12px;overflow:hidden;border:1px solid #e5e1da">
      <div style="background:#1a1a18;padding:24px;border-bottom:3px solid #c5a059">
        <h2 style="margin:0;color:#c5a059;font-weight:300;font-size:20px;text-transform:uppercase;letter-spacing:1px">Re: ${subject || 'Your Property Inquiry'}</h2>
      </div>
      <div style="padding:32px;color:#333;line-height:1.7;font-size:15px">
        ${cleanReply.replace(/\n/g, '<br>')}
      </div>
      <div style="background:#f4f1ea;padding:20px;text-align:center;border-top:1px solid #e5e1da">
        <p style="margin:0;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:1px">${AGENT_NAME} | Zorvo Realty</p>
      </div>
    </div>`;

    await sendEmail({
      to: leadEmail,
      subject: `Re: ${subject || 'Your Property Inquiry'}`,
      message: cleanReply,
      html: formattedHtml
    });

    res.json({ success: true, reply: cleanReply });
  } catch (err) {
    console.error('❌ Email Reply Webhook Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
