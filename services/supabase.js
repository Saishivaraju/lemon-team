const { createClient } = require('@supabase/supabase-js');

/**
 * Supabase Service
 * Handles leads, visits, qualifications, agreements, and documents
 */
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// ─── LEADS ────────────────────────────────────────────────────────────────────

const saveLeadToSupabase = async (lead) => {
  if (!supabase) return { success: false, error: 'Supabase not configured' };
  try {
    const leadRecord = {
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      property_interest: lead.property_interest,
      notes: lead.notes,
      source: lead.source || 'Website',
      status: lead.status || 'New',
      budget: lead.budget || null,
      bhk_preference: lead.bhk_preference || null,
      pre_approval_status: lead.pre_approval_status || null,
      qualification_score: lead.qualification_score || 0,
      qualification_id: lead.qualification_id || null,
      created_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from('leads').insert([leadRecord]).select().single();
    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('❌ Supabase Lead Save Error:', error.message);
    return { success: false, error: error.message };
  }
};

// ─── VISITS ───────────────────────────────────────────────────────────────────

const saveVisitToSupabase = async (visit) => {
  if (!supabase) return { success: false, error: 'Supabase not configured' };
  try {
    const visitRecord = {
      property_name: visit.property_name,
      client_name: visit.client_name,
      client_email: visit.client_email,
      client_phone: visit.client_phone,
      visit_date: visit.visit_date,
      visit_time: visit.visit_time,
      status: visit.status || 'pending',
      outcome: visit.outcome || null,
      notes: visit.notes || null,
      agreement_id: visit.agreement_id || null,
      qualification_id: visit.qualification_id || null,
      virtual_tour_link: visit.virtual_tour_link || null,
      whatsapp_sent: false,
      created_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from('visits').insert([visitRecord]).select().single();
    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('❌ Supabase Visit Save Error:', error.message);
    return { success: false, error: error.message };
  }
};

const updateVisitInSupabase = async (id, updates) => {
  if (!supabase) return { success: false, error: 'Supabase not configured' };
  try {
    const { data, error } = await supabase.from('visits').update(updates).eq('id', id);
    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('❌ Supabase Visit Update Error:', error.message);
    return { success: false, error: error.message };
  }
};

const deleteVisitFromSupabase = async (id) => {
  if (!supabase) return { success: false, error: 'Supabase not configured' };
  try {
    const { data, error } = await supabase.from('visits').delete().eq('id', id);
    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('❌ Supabase Visit Delete Error:', error.message);
    return { success: false, error: error.message };
  }
};

const getVisitFromSupabase = async (id) => {
  if (!supabase) return { success: false, error: 'Supabase not configured' };
  try {
    const { data, error } = await supabase.from('visits').select('*').eq('id', id).single();
    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

const getVisitsByDate = async (date) => {
  if (!supabase) return { success: false, error: 'Supabase not configured' };
  try {
    const { data, error } = await supabase
      .from('visits').select('*').eq('visit_date', date).neq('status', 'rejected');
    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// ─── AI QUALIFICATIONS ────────────────────────────────────────────────────────

const saveQualification = async (qualification) => {
  if (!supabase) return { success: false, error: 'Supabase not configured' };
  try {
    const record = {
      session_token: qualification.session_token,
      name: qualification.name || null,
      email: qualification.email || null,
      phone: qualification.phone || null,
      budget: qualification.budget,
      bhk_preference: qualification.bhk_preference,
      pre_approval_status: qualification.pre_approval_status,
      qualification_score: qualification.qualification_score || 0,
      is_qualified: qualification.is_qualified || false,
      answers: qualification.answers || {},
      created_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from('ai_qualifications').insert([record]).select().single();
    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('❌ Supabase Qualification Save Error:', error.message);
    return { success: false, error: error.message };
  }
};

const getQualification = async (sessionToken) => {
  if (!supabase) return { success: false, error: 'Supabase not configured' };
  try {
    const { data, error } = await supabase
      .from('ai_qualifications').select('*').eq('session_token', sessionToken).single();
    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// ─── BUYER AGREEMENTS ─────────────────────────────────────────────────────────

const saveAgreement = async (agreement) => {
  if (!supabase) return { success: false, error: 'Supabase not configured' };
  try {
    const record = {
      session_token: agreement.session_token,
      signer_name: agreement.signer_name,
      signer_email: agreement.signer_email || null,
      signer_phone: agreement.signer_phone || null,
      ip_address: agreement.ip_address || null,
      signed_at: agreement.signed_at || new Date().toISOString(),
      agreement_version: 'v1.0',
      agreement_text: agreement.agreement_text || null,
      property_name: agreement.property_name || null,
      qualification_id: agreement.qualification_id || null,
      created_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from('buyer_agreements').insert([record]).select().single();
    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('❌ Supabase Agreement Save Error:', error.message);
    return { success: false, error: error.message };
  }
};

const getAgreement = async (sessionToken) => {
  if (!supabase) return { success: false, error: 'Supabase not configured' };
  try {
    const { data, error } = await supabase
      .from('buyer_agreements').select('*').eq('session_token', sessionToken).single();
    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// ─── DOCUMENTS ────────────────────────────────────────────────────────────────

const saveDocument = async (doc) => {
  if (!supabase) return { success: false, error: 'Supabase not configured' };
  try {
    const record = {
      lead_id: doc.lead_id || null,
      visit_id: doc.visit_id || null,
      agreement_id: doc.agreement_id || null,
      doc_type: doc.doc_type || 'other',
      file_name: doc.file_name,
      file_data: doc.file_data || null,
      file_mime: doc.file_mime || 'application/pdf',
      file_size_kb: doc.file_size_kb || null,
      uploader: doc.uploader || 'agent',
      notes: doc.notes || null,
      created_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from('documents').insert([record]).select().single();
    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('❌ Supabase Document Save Error:', error.message);
    return { success: false, error: error.message };
  }
};

const getDocumentsByLead = async (leadId) => {
  if (!supabase) return { success: false, error: 'Supabase not configured' };
  try {
    const { data, error } = await supabase
      .from('documents').select('*').eq('lead_id', leadId).order('created_at', { ascending: false });
    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

const getAllDocuments = async () => {
  if (!supabase) return { success: false, error: 'Supabase not configured' };
  try {
    const { data, error } = await supabase
      .from('documents').select('*').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

const getAllAgreements = async () => {
  if (!supabase) return { success: false, error: 'Supabase not configured' };
  try {
    const { data, error } = await supabase
      .from('buyer_agreements').select('*').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

module.exports = {
  saveLeadToSupabase,
  saveVisitToSupabase,
  updateVisitInSupabase,
  deleteVisitFromSupabase,
  getVisitFromSupabase,
  getVisitsByDate,
  saveQualification,
  getQualification,
  saveAgreement,
  getAgreement,
  saveDocument,
  getDocumentsByLead,
  getAllDocuments,
  getAllAgreements
};

// ─── TEAM AGENTS ─────────────────────────────────────────────────────────────

const getTeamAgents = async (teamId) => {
  if (!supabase) return { success: false, data: [] };
  try {
    const { data, error } = await supabase
      .from('team_members').select('*').eq('team_id', teamId).eq('role', 'agent');
    if (error) throw error;
    return { success: true, data };
  } catch (e) {
    return { success: false, data: [], error: e.message };
  }
};

// ─── CALL LOGS ────────────────────────────────────────────────────────────────

const saveCallLogSupabase = async (log) => {
  if (!supabase) return { success: false, error: 'Supabase not configured' };
  try {
    const { data, error } = await supabase
      .from('team_call_logs').insert([log]).select().single();
    if (error) throw error;
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
};

module.exports = {
  ...module.exports,
  getTeamAgents,
  saveCallLogSupabase,
};
