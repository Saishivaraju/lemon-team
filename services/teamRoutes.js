// ─────────────────────────────────────────────────────────────────────────────
// services/teamRoutes.js — All Team Edition API Routes
// Mount in api/index.js with: require('./services/teamRoutes')(app)
// ─────────────────────────────────────────────────────────────────────────────
const { createClient } = require('@supabase/supabase-js');
const { registerAgent, loginAgent, authMiddleware, leaderOnly, hashPassword, signToken } = require('./auth');
const { sendEmail } = require('./email');
const crypto = require('crypto');

const getDB = () => (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

module.exports = function mountTeamRoutes(app) {

  // ── POST /api/team/register-leader ────────────────────────────────────────
  // Creates Team Leader + a new Team in one shot
  app.post('/api/team/register-leader', async (req, res) => {
    try {
      const { name, email, password, phone, teamName } = req.body;
      if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' });
      const result = await registerAgent({ name, email, password, phone, role: 'leader', teamName: teamName || `${name}'s Team` });
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── POST /api/team/login ──────────────────────────────────────────────────
  app.post('/api/team/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'email and password required' });
      const result = await loginAgent({ email, password });
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── GET /api/team/me ──────────────────────────────────────────────────────
  app.get('/api/team/me', authMiddleware, async (req, res) => {
    try {
      const db = getDB();
      const { data, error } = await db.from('team_members').select('id,name,email,role,phone,calendar_link,team_id,status').eq('id', req.user.id).single();
      if (error) return res.status(404).json({ error: 'User not found' });
      res.json({ success: true, user: data });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── PATCH /api/team/me ────────────────────────────────────────────────────
  // Agent updates their own profile (phone, calendar link)
  app.patch('/api/team/me', authMiddleware, async (req, res) => {
    try {
      const db = getDB();
      const { name, phone, calendar_link, password } = req.body;
      const updates = {};
      if (name) updates.name = name;
      if (phone) updates.phone = phone;
      if (calendar_link) updates.calendar_link = calendar_link;
      if (password) updates.password_hash = hashPassword(password);

      const { data, error } = await db.from('team_members').update(updates).eq('id', req.user.id).select().single();
      if (error) throw error;
      res.json({ success: true, user: data });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── POST /api/team/invite ─────────────────────────────────────────────────
  // Leader invites an agent by email
  app.post('/api/team/invite', authMiddleware, leaderOnly, async (req, res) => {
    try {
      const db = getDB();
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'email required' });

      const inviteToken = crypto.randomBytes(20).toString('hex');
      const { error } = await db.from('team_invites').insert([{
        team_id: req.user.teamId,
        invited_by: req.user.id,
        email,
        token: inviteToken,
        status: 'pending',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      }]);
      if (error) throw error;

      const BASE_URL = process.env.BASE_URL || 'https://lemon-mocha.vercel.app';
      const inviteLink = `${BASE_URL}/team_dashboard.html?invite=${inviteToken}`;

      await sendEmail({
        to: email,
        subject: `You've been invited to join ${process.env.COMPANY_NAME || 'Zorvo Realty'} on Zorvo`,
        message: `You have been invited to join the team. Click the link to create your account: ${inviteLink}`,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#111520;border-radius:12px;overflow:hidden;border:1px solid rgba(240,192,64,0.3)">
          <div style="background:linear-gradient(135deg,#1a1a18,#0f2044);padding:32px;text-align:center;border-bottom:2px solid #f0c040">
            <h1 style="margin:0;color:#f0c040;font-size:22px;font-weight:700">🏡 Zorvo Team Invite</h1>
          </div>
          <div style="padding:32px;color:#dee4ed">
            <p style="font-size:16px">You have been invited to join <strong style="color:#f0c040">${process.env.COMPANY_NAME || 'Zorvo Realty'}</strong> on the Zorvo AI Real Estate Platform.</p>
            <p style="color:#8b9bb4">Click the button below to create your agent account and join the team.</p>
            <div style="text-align:center;margin:32px 0">
              <a href="${inviteLink}" style="background:linear-gradient(135deg,#f0c040,#e07830);color:#000;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">Accept Invite & Join Team →</a>
            </div>
            <p style="color:#8b9bb4;font-size:12px">This invite expires in 7 days. If you did not expect this email, you can safely ignore it.</p>
          </div>
        </div>`
      });

      res.json({ success: true, message: `Invite sent to ${email}` });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── POST /api/team/accept-invite ──────────────────────────────────────────
  // Agent accepts invite and creates their account
  app.post('/api/team/accept-invite', async (req, res) => {
    try {
      const db = getDB();
      const { token, name, password, phone } = req.body;
      if (!token || !name || !password) return res.status(400).json({ error: 'token, name, password required' });

      const { data: invite, error: invErr } = await db.from('team_invites').select('*').eq('token', token).eq('status', 'pending').single();
      if (invErr || !invite) return res.status(400).json({ error: 'Invalid or expired invite token' });
      if (new Date(invite.expires_at) < new Date()) return res.status(400).json({ error: 'Invite has expired' });

      // Register the agent under the team
      const pHash = hashPassword(password);
      const { data: member, error: memErr } = await db.from('team_members').insert([{
        name, email: invite.email, password_hash: pHash, phone: phone || null,
        role: 'agent', team_id: invite.team_id, status: 'active',
        leads_assigned: 0, created_at: new Date().toISOString()
      }]).select().single();
      if (memErr) throw memErr;

      // Mark invite as accepted
      await db.from('team_invites').update({ status: 'accepted' }).eq('id', invite.id);

      const jwtToken = signToken({ id: member.id, email: member.email, role: 'agent', teamId: member.team_id, name: member.name });
      res.json({ success: true, token: jwtToken, user: { id: member.id, name: member.name, email: member.email, role: 'agent', teamId: member.team_id } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── GET /api/team/agents ──────────────────────────────────────────────────
  // Leader gets all agents in their team
  app.get('/api/team/agents', authMiddleware, leaderOnly, async (req, res) => {
    try {
      const db = getDB();
      const { data, error } = await db.from('team_members')
        .select('id,name,email,phone,role,status,leads_assigned,calendar_link,created_at')
        .eq('team_id', req.user.teamId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      res.json({ success: true, agents: data });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── PATCH /api/team/agents/:id/deactivate ─────────────────────────────────
  app.patch('/api/team/agents/:id/deactivate', authMiddleware, leaderOnly, async (req, res) => {
    try {
      const db = getDB();
      await db.from('team_members').update({ status: 'inactive' }).eq('id', req.params.id).eq('team_id', req.user.teamId);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── GET /api/team/leads ───────────────────────────────────────────────────
  // Leader → all leads | Agent → only their leads
  app.get('/api/team/leads', authMiddleware, async (req, res) => {
    try {
      const db = getDB();
      let query = db.from('team_leads').select('*').order('created_at', { ascending: false });

      if (req.user.role === 'leader') {
        // Leader can filter by specific agent
        query = query.eq('team_id', req.user.teamId);
        if (req.query.agentId) query = query.eq('agent_id', req.query.agentId);
      } else {
        // Agent only sees their own leads
        query = query.eq('agent_id', req.user.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      res.json({ success: true, leads: data });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── POST /api/team/reassign ─────────────────────────────────────────────
  // Reassign leads from one agent to another (Leader only)
  app.post('/api/team/reassign', authMiddleware, leaderOnly, async (req, res) => {
    try {
      const { leadIds, targetAgentEmail } = req.body;
      if (!leadIds || !leadIds.length || !targetAgentEmail) {
        return res.status(400).json({ error: 'Missing leadIds or targetAgentEmail' });
      }

      const db = getDB();
      // Find target agent ID
      const { data: targetAgent, error: targetErr } = await db.from('team_members')
        .select('id, email, name')
        .eq('email', targetAgentEmail)
        .eq('team_id', req.user.teamId)
        .single();
        
      if (targetErr || !targetAgent) {
        return res.status(404).json({ error: 'Target agent not found in your team' });
      }

      // Update leads in team_leads
      const { data: updatedLeads, error: updateErr } = await db.from('team_leads')
        .update({ agent_id: targetAgent.id })
        .in('id', leadIds)
        .eq('team_id', req.user.teamId)
        .select();

      if (updateErr) throw updateErr;

      // Also trigger a real-time notification to the new agent via DataSnapshot
      try {
        const mongoose = require('mongoose');
        const DataSnapshot = mongoose.models.DataSnapshot || mongoose.model('DataSnapshot', new mongoose.Schema({ email: String, data: Object }));
        
        let targetSnap = await DataSnapshot.findOne({ email: targetAgentEmail });
        if (!targetSnap) targetSnap = new DataSnapshot({ email: targetAgentEmail, data: {} });
        
        const currentNotifs = targetSnap.data.pe_notifications || [];
        currentNotifs.unshift({
          id: 'n_' + Date.now(),
          type: 'Assignment',
          title: '🔄 Leads Reassigned',
          message: `${leadIds.length} lead(s) were reassigned to you by the Team Leader.`,
          date: new Date().toISOString(),
          read: false
        });
        targetSnap.data.pe_notifications = currentNotifs;
        targetSnap.markModified('data');
        await targetSnap.save();
      } catch (e) { console.error('Failed to update DataSnapshot for reassign:', e.message); }

      res.json({ success: true, message: `Reassigned ${updatedLeads.length} leads to ${targetAgent.name}` });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── PATCH /api/team/leads/:id ─────────────────────────────────────────────
  // Update lead stage or reassign (leader can reassign)
  app.patch('/api/team/leads/:id', authMiddleware, async (req, res) => {
    try {
      const db = getDB();
      const { stage, agent_id, ai_score, ai_notes, ai_summary } = req.body;
      const updates = { updated_at: new Date().toISOString() };
      if (stage) updates.stage = stage;
      if (ai_score) updates.ai_score = ai_score;
      if (ai_notes) updates.ai_notes = ai_notes;
      if (ai_summary) updates.ai_summary = ai_summary;

      // Only leader can reassign
      if (agent_id && req.user.role === 'leader') updates.agent_id = agent_id;

      const { data, error } = await db.from('team_leads').update(updates).eq('id', req.params.id).select().single();
      if (error) throw error;
      res.json({ success: true, lead: data });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── GET /api/team/properties ──────────────────────────────────────────────
  // Leader → all | Agent → their own
  app.get('/api/team/properties', authMiddleware, async (req, res) => {
    try {
      const db = getDB();
      let query = db.from('team_properties').select('*').order('created_at', { ascending: false });

      if (req.user.role === 'leader') {
        query = query.eq('team_id', req.user.teamId);
      } else {
        query = query.eq('agent_id', req.user.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      res.json({ success: true, properties: data });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── POST /api/team/properties ─────────────────────────────────────────────
  // Agent uploads a property
  app.post('/api/team/properties', authMiddleware, async (req, res) => {
    try {
      const db = getDB();
      const { name, property_type, location, address, price, price_label, bedrooms, bathrooms,
        area_sqft, description, neighborhood_info, financing_options, key_selling_points, features, images } = req.body;
      if (!name) return res.status(400).json({ error: 'Property name required' });

      const { data, error } = await db.from('team_properties').insert([{
        agent_id: req.user.id,
        team_id: req.user.teamId,
        name, property_type, location, address, price, price_label, bedrooms, bathrooms,
        area_sqft, description, neighborhood_info, financing_options, key_selling_points,
        features: features || [],
        images: images || [],
        status: 'available',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }]).select().single();

      if (error) throw error;
      res.json({ success: true, property: data });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── PATCH /api/team/properties/:id ───────────────────────────────────────
  app.patch('/api/team/properties/:id', authMiddleware, async (req, res) => {
    try {
      const db = getDB();
      const updates = { ...req.body, updated_at: new Date().toISOString() };
      delete updates.agent_id; // can't change ownership

      const { data, error } = await db.from('team_properties').update(updates).eq('id', req.params.id).eq('agent_id', req.user.id).select().single();
      if (error) throw error;
      res.json({ success: true, property: data });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── DELETE /api/team/properties/:id ──────────────────────────────────────
  app.delete('/api/team/properties/:id', authMiddleware, async (req, res) => {
    try {
      const db = getDB();
      const filter = req.user.role === 'leader'
        ? { id: req.params.id, team_id: req.user.teamId }
        : { id: req.params.id, agent_id: req.user.id };
      await db.from('team_properties').delete().match(filter);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── GET /api/team/calls ───────────────────────────────────────────────────
  // Leader → all | Agent → their calls
  app.get('/api/team/calls', authMiddleware, async (req, res) => {
    try {
      const db = getDB();
      let query = db.from('team_call_logs').select('*').order('called_at', { ascending: false }).limit(100);

      if (req.user.role === 'leader') {
        query = query.eq('team_id', req.user.teamId);
        if (req.query.agentId) query = query.eq('agent_id', req.query.agentId);
      } else {
        query = query.eq('agent_id', req.user.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      res.json({ success: true, calls: data });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── GET /api/team/report ──────────────────────────────────────────────────
  // Leader dashboard: per-agent performance metrics
  app.get('/api/team/report', authMiddleware, leaderOnly, async (req, res) => {
    try {
      const db = getDB();
      const since = req.query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

      const [leadsRes, callsRes, agentsRes, propsRes, bookingsRes] = await Promise.all([
        db.from('team_leads').select('stage,agent_id,ai_score,created_at,updated_at').eq('team_id', req.user.teamId).gte('created_at', since),
        db.from('team_call_logs').select('status,agent_id,duration_sec,ai_score,called_at,lead_id').eq('team_id', req.user.teamId).gte('called_at', since),
        db.from('team_members').select('id,name,email,leads_assigned,status').eq('team_id', req.user.teamId).eq('role', 'agent'),
        db.from('team_properties').select('id,agent_id,status').eq('team_id', req.user.teamId),
        db.from('visits').select('agent_id,status,created_at').gte('created_at', since),
      ]);

      const leads = leadsRes.data || [];
      const calls = callsRes.data || [];
      const agents = agentsRes.data || [];
      const props = propsRes.data || [];
      const bookings = bookingsRes.data || [];

      const agentStats = agents.map(agent => {
        const aLeads = leads.filter(l => l.agent_id === agent.id);
        const aCalls = calls.filter(c => c.agent_id === agent.id);
        const aProps = props.filter(p => p.agent_id === agent.id);
        const aBookings = bookings.filter(b => b.agent_id === agent.id && b.status === 'confirmed');
        const hot = aLeads.filter(l => l.ai_score === 'HOT').length;
        const won = aLeads.filter(l => l.stage === 'won' || l.stage === 'closed').length;

        // ── Response time: avg hours from lead.created_at → first call for that lead ──
        let responseTimeHours = null;
        const leadsWithCalls = aLeads.map(lead => {
          const firstCall = aCalls
            .filter(c => c.lead_id === lead.id)
            .sort((a, b) => new Date(a.called_at) - new Date(b.called_at))[0];
          if (!firstCall) return null;
          return (new Date(firstCall.called_at) - new Date(lead.created_at)) / (1000 * 60 * 60);
        }).filter(h => h !== null && h >= 0);
        if (leadsWithCalls.length > 0) {
          responseTimeHours = Math.round((leadsWithCalls.reduce((s, h) => s + h, 0) / leadsWithCalls.length) * 10) / 10;
        }

        // ── Cold untouched: leads still in 'new' stage for 3+ days ──
        const coldUntouched = aLeads.filter(l =>
          (l.stage === 'new' || !l.stage) && new Date(l.created_at) < new Date(threeDaysAgo)
        ).length;

        return {
          id: agent.id, name: agent.name, email: agent.email, status: agent.status,
          leads: aLeads.length, calls: aCalls.length, properties: aProps.length,
          hot_leads: hot, won_deals: won,
          conversion_pct: aLeads.length > 0 ? Math.round((won / aLeads.length) * 100) : 0,
          appointments_booked: aBookings.length,
          response_time_hours: responseTimeHours,
          cold_untouched: coldUntouched,
        };
      });

      const pipeline = {
        new: leads.filter(l => l.stage === 'new').length,
        contacted: leads.filter(l => l.stage === 'contacted').length,
        qualified: leads.filter(l => l.stage === 'qualified').length,
        appointment: leads.filter(l => l.stage === 'appointment').length,
        showing: leads.filter(l => l.stage === 'showing').length,
        negotiation: leads.filter(l => l.stage === 'negotiation').length,
        won: leads.filter(l => l.stage === 'won' || l.stage === 'closed').length,
        lost: leads.filter(l => l.stage === 'lost').length,
      };

      res.json({
        success: true,
        summary: {
          total_leads: leads.length,
          total_calls: calls.length,
          total_agents: agents.length,
          hot_leads: leads.filter(l => l.ai_score === 'HOT').length,
          warm_leads: leads.filter(l => l.ai_score === 'WARM').length,
          cold_leads: leads.filter(l => l.ai_score === 'COLD').length,
          won_deals: leads.filter(l => l.stage === 'won' || l.stage === 'closed').length,
        },
        pipeline,
        agents: agentStats,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── POST /api/team/notify-agent ───────────────────────────────────────────
  // Internal use: send notification to specific agent
  app.post('/api/team/notify-agent', async (req, res) => {
    try {
      const { agentId, agentEmail, title, description, emailSubject } = req.body;
      const db = getDB();

      // Resolve agent email if not provided
      let targetEmail = agentEmail;
      if (!targetEmail && agentId) {
        const { data } = await db.from('team_members').select('email').eq('id', agentId).single();
        if (data) targetEmail = data.email;
      }

      if (targetEmail && emailSubject) {
        await sendEmail({
          to: targetEmail,
          subject: emailSubject,
          message: `${title}\n\n${description}`,
          html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#111520;border-radius:12px;border:1px solid rgba(240,192,64,0.3)">
            <div style="background:#1a1a18;padding:24px;text-align:center;border-bottom:2px solid #f0c040">
              <h2 style="color:#f0c040;margin:0">${title}</h2>
            </div>
            <div style="padding:24px;color:#dee4ed">
              <p style="white-space:pre-line">${description}</p>
              <div style="text-align:center;margin-top:24px">
                <a href="${process.env.BASE_URL || 'https://lemon-mocha.vercel.app'}/team_dashboard.html" style="background:#f0c040;color:#000;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700">Open Dashboard →</a>
              </div>
            </div>
          </div>`
        });
      }

      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── POST /api/team/assign-lead ────────────────────────────────────────────
  // Smart assignment: Property-owner first, then round-robin
  app.post('/api/team/assign-lead', async (req, res) => {
    try {
      const db = getDB();
      const { leadId, teamId, propertyName, propertyId } = req.body;
      if (!teamId) return res.status(400).json({ error: 'teamId required' });

      let assignedAgent = null;

      // Option A: Assign to the agent who owns the property
      if (propertyId || propertyName) {
        let propQuery = db.from('team_properties').select('agent_id,team_id');
        if (propertyId) propQuery = propQuery.eq('id', propertyId);
        else propQuery = propQuery.eq('team_id', teamId).ilike('name', `%${propertyName}%`);
        const { data: prop } = await propQuery.single();
        if (prop && prop.agent_id) {
          const { data: agent } = await db.from('team_members').select('*').eq('id', prop.agent_id).eq('status', 'active').single();
          if (agent) assignedAgent = agent;
        }
      }

      // Option B: Round-robin fallback
      if (!assignedAgent) {
        const { data: rrData } = await db.from('team_round_robin').select('*').eq('team_id', teamId).single();
        const { data: agents } = await db.from('team_members').select('*').eq('team_id', teamId).eq('role', 'agent').eq('status', 'active').order('created_at', { ascending: true });

        if (agents && agents.length > 0) {
          const lastIdx = rrData ? rrData.last_agent_idx : 0;
          const nextIdx = (lastIdx + 1) % agents.length;
          assignedAgent = agents[nextIdx];

          // Update round-robin pointer
          await db.from('team_round_robin').upsert([{ team_id: teamId, last_agent_idx: nextIdx, updated_at: new Date().toISOString() }]);
        }
      }

      if (!assignedAgent) return res.status(404).json({ error: 'No active agents found for this team' });

      // Update lead with assigned agent
      if (leadId) {
        await db.from('team_leads').update({ agent_id: assignedAgent.id, updated_at: new Date().toISOString() }).eq('id', leadId);
        // Increment agent lead count
        await db.from('team_members').update({ leads_assigned: (assignedAgent.leads_assigned || 0) + 1 }).eq('id', assignedAgent.id);
      }

      res.json({ success: true, agent: { id: assignedAgent.id, name: assignedAgent.name, email: assignedAgent.email, phone: assignedAgent.phone } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  console.log('✅ Team routes mounted');
};
