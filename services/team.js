// ─────────────────────────────────────────────────────────────────────────────
// services/team.js — Multi-Agent Routing + Management
// ─────────────────────────────────────────────────────────────────────────────
const { createClient } = require('@supabase/supabase-js');

const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

// ── ASSIGN lead to an agent (round-robin or by location) ─────────────────────
async function assignLeadToAgent(lead, teamId) {
  if (!supabase) return null;

  try {
    // Get all active agents for this team
    const { data: agents } = await supabase
      .from('team_members')
      .select('*')
      .eq('team_id', teamId)
      .eq('role', 'agent')
      .eq('status', 'active')
      .order('leads_assigned', { ascending: true }); // least busy first

    if (!agents || agents.length === 0) return null;

    // Location-based routing
    let assignedAgent = null;
    if (lead.location || lead.property_interest) {
      const keyword = (lead.location || lead.property_interest || '').toLowerCase();
      assignedAgent = agents.find(a =>
        a.coverage_areas && a.coverage_areas.some(area =>
          keyword.includes(area.toLowerCase())
        )
      );
    }

    // Fallback: round-robin (least loaded agent)
    if (!assignedAgent) assignedAgent = agents[0];

    // Increment leads count
    await supabase
      .from('team_members')
      .update({ leads_assigned: (assignedAgent.leads_assigned || 0) + 1 })
      .eq('id', assignedAgent.id);

    return assignedAgent;
  } catch (err) {
    console.error('assignLeadToAgent error:', err.message);
    return null;
  }
}

// ── SAVE lead with agent assignment ──────────────────────────────────────────
async function saveTeamLead(lead, agentId, teamId) {
  if (!supabase) return { success: false, error: 'Supabase not configured' };

  try {
    const { data, error } = await supabase
      .from('team_leads')
      .insert([{
        name:              lead.name,
        phone:             lead.phone,
        email:             lead.email,
        property_interest: lead.property_interest,
        budget:            lead.budget,
        source:            lead.source || 'Website',
        stage:             'new',          // pipeline stage
        agent_id:          agentId,
        team_id:           teamId,
        created_at:        new Date().toISOString(),
      }])
      .select()
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── UPDATE lead pipeline stage ────────────────────────────────────────────────
async function updateLeadStage(leadId, stage) {
  // Allowed stages: new → contacted → qualified → booked → visited → closed → lost
  if (!supabase) return { success: false };
  const { error } = await supabase
    .from('team_leads')
    .update({ stage, updated_at: new Date().toISOString() })
    .eq('id', leadId);
  return { success: !error };
}

// ── SAVE call log (recording + transcript) ────────────────────────────────────
async function saveCallLog({ leadId, agentId, teamId, phone, duration, transcript, recordingUrl, status }) {
  if (!supabase) return { success: false };
  try {
    const { data, error } = await supabase
      .from('team_call_logs')
      .insert([{
        lead_id:       leadId,
        agent_id:      agentId,
        team_id:       teamId,
        phone,
        duration_sec:  duration || 0,
        transcript:    transcript || '',
        recording_url: recordingUrl || null,
        status,          // answered | no_answer | failed
        called_at:     new Date().toISOString(),
      }])
      .select()
      .single();
    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── GET team reporting metrics ────────────────────────────────────────────────
async function getTeamReport(teamId, fromDate) {
  if (!supabase) return null;

  const since = fromDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const [leadsRes, callsRes, bookingsRes, agentsRes] = await Promise.all([
      supabase.from('team_leads').select('stage, agent_id, created_at').eq('team_id', teamId).gte('created_at', since),
      supabase.from('team_call_logs').select('status, agent_id, duration_sec, called_at').eq('team_id', teamId).gte('called_at', since),
      supabase.from('visits').select('status, created_at').gte('created_at', since),
      supabase.from('team_members').select('id, name, email, leads_assigned').eq('team_id', teamId).eq('role', 'agent'),
    ]);

    const leads    = leadsRes.data    || [];
    const calls    = callsRes.data    || [];
    const bookings = bookingsRes.data || [];
    const agents   = agentsRes.data   || [];

    // Per-agent breakdown
    const agentStats = agents.map(agent => {
      const agentLeads = leads.filter(l => l.agent_id === agent.id);
      const agentCalls = calls.filter(c => c.agent_id === agent.id);
      const answered   = agentCalls.filter(c => c.status === 'answered').length;
      const booked     = agentLeads.filter(l => l.stage === 'booked' || l.stage === 'visited').length;

      return {
        agent_id:        agent.id,
        name:            agent.name,
        leads_total:     agentLeads.length,
        calls_made:      agentCalls.length,
        calls_answered:  answered,
        bookings:        booked,
        conversion_pct:  agentLeads.length > 0
          ? Math.round((booked / agentLeads.length) * 100)
          : 0,
      };
    });

    // Pipeline breakdown
    const pipeline = {
      new:        leads.filter(l => l.stage === 'new').length,
      contacted:  leads.filter(l => l.stage === 'contacted').length,
      qualified:  leads.filter(l => l.stage === 'qualified').length,
      booked:     leads.filter(l => l.stage === 'booked').length,
      visited:    leads.filter(l => l.stage === 'visited').length,
      closed:     leads.filter(l => l.stage === 'closed').length,
      lost:       leads.filter(l => l.stage === 'lost').length,
    };

    const answeredTotal = calls.filter(c => c.status === 'answered').length;

    return {
      summary: {
        total_leads:       leads.length,
        calls_made:        calls.length,
        calls_answered:    answeredTotal,
        answer_rate_pct:   calls.length > 0 ? Math.round((answeredTotal / calls.length) * 100) : 0,
        bookings:          bookings.length,
        conversion_pct:    leads.length > 0 ? Math.round((bookings.length / leads.length) * 100) : 0,
      },
      pipeline,
      agents: agentStats,
    };
  } catch (err) {
    console.error('getTeamReport error:', err.message);
    return null;
  }
}

// ── GET team leader (role = 'leader' or 'admin') ──────────────────────────────
const FALLBACK_LEADER_EMAIL = process.env.AGENT_EMAIL || 'saishivaraju.m2002@gmail.com';
async function getTeamLeader(teamId) {
  if (!supabase) return { email: FALLBACK_LEADER_EMAIL, name: process.env.AGENT_NAME || 'Team Leader' };
  try {
    // Try explicit leader/admin role first
    const { data: leaders } = await supabase
      .from('team_members')
      .select('id, name, email, phone')
      .eq('team_id', teamId)
      .in('role', ['leader', 'admin', 'owner'])
      .eq('status', 'active')
      .limit(1);
    if (leaders && leaders.length > 0) return leaders[0];

    // Fallback: oldest member = founder/leader
    const { data: oldest } = await supabase
      .from('team_members')
      .select('id, name, email, phone')
      .eq('team_id', teamId)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1);
    if (oldest && oldest.length > 0) return oldest[0];
  } catch (err) {
    console.error('getTeamLeader error:', err.message);
  }
  return { email: FALLBACK_LEADER_EMAIL, name: process.env.AGENT_NAME || 'Team Leader' };
}

// ── GET all properties from all agents (for unified public listing) ────────────
async function getAllAgentProperties(DataSnapshot) {
  try {
    const snapshots = await DataSnapshot.find({});
    const allProperties = [];

    for (const snap of snapshots) {
      if (!snap.data || !snap.data.pe_properties) continue;
      let props = snap.data.pe_properties;
      if (typeof props === 'string') {
        try { props = JSON.parse(props); } catch (e) { continue; }
      }
      if (!Array.isArray(props)) continue;

      // Resolve agent display name from Supabase if possible
      let agentName = null;
      let agentPhone = null;
      if (supabase) {
        try {
          const { data: member } = await supabase
            .from('team_members')
            .select('name, phone')
            .eq('email', snap.email)
            .single();
          if (member) { agentName = member.name; agentPhone = member.phone; }
        } catch (_) {}
      }

      // Fallback to snapshot agent profile
      if (!agentName && snap.data.pe_agent) {
        try {
          const agentProfile = typeof snap.data.pe_agent === 'string'
            ? JSON.parse(snap.data.pe_agent) : snap.data.pe_agent;
          agentName = agentProfile?.name || null;
          agentPhone = agentProfile?.phone || null;
        } catch (_) {}
      }

      // Stamp each property with listing agent attribution
      props.forEach(p => {
        allProperties.push({
          ...p,
          listed_by_email: snap.email,
          listed_by_name: agentName || snap.email.split('@')[0],
          listed_by_phone: agentPhone || null,
        });
      });
    }

    return allProperties;
  } catch (err) {
    console.error('getAllAgentProperties error:', err.message);
    return [];
  }
}

module.exports = {
  assignLeadToAgent,
  saveTeamLead,
  updateLeadStage,
  saveCallLog,
  getTeamReport,
  getTeamLeader,
  getAllAgentProperties,
};
