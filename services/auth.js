// ─────────────────────────────────────────────────────────────────────────────
// services/auth.js — Team Auth Service (JWT-based)
// ─────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

const JWT_SECRET = process.env.JWT_SECRET || 'zorvo_team_jwt_secret_2026';

// ── Minimal JWT implementation (no external dep) ──────────────────────────────
function base64url(str) {
  return Buffer.from(str).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signToken(payload, expiresInHours = 24) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  payload.exp = Math.floor(Date.now() / 1000) + expiresInHours * 3600;
  payload.iat = Math.floor(Date.now() / 1000);
  const body = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (sig !== expectedSig) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) { return null; }
}

// ── Hash password ─────────────────────────────────────────────────────────────
function hashPassword(password) {
  return crypto.createHmac('sha256', JWT_SECRET).update(password).digest('hex');
}

// ── Register agent ────────────────────────────────────────────────────────────
async function registerAgent({ name, email, password, phone, role = 'agent', teamName, calendarLink }) {
  if (!supabase) return { success: false, error: 'Database not configured' };

  try {
    // Check if email already exists
    const { data: existing } = await supabase
      .from('team_members')
      .select('id')
      .eq('email', email)
      .limit(1);

    if (existing && existing.length > 0) {
      return { success: false, error: 'An account with this email already exists.' };
    }

    const passwordHash = hashPassword(password);

    // If role is leader, create a new team
    let teamId = null;
    if (role === 'leader') {
      const { data: team, error: teamErr } = await supabase
        .from('teams')
        .insert([{ name: teamName || `${name}'s Team`, created_at: new Date().toISOString() }])
        .select()
        .single();
      if (teamErr) throw teamErr;
      teamId = team.id;
    }

    const { data, error } = await supabase
      .from('team_members')
      .insert([{
        name,
        email,
        password_hash: passwordHash,
        phone: phone || null,
        role,
        team_id: teamId,
        calendar_link: calendarLink || null,
        status: 'active',
        leads_assigned: 0,
        created_at: new Date().toISOString(),
      }])
      .select()
      .single();

    if (error) throw error;

    // If agent, update their team_id to match their own ID for now (pending leader invite)
    const token = signToken({ id: data.id, email: data.email, role: data.role, teamId: data.team_id });

    return {
      success: true,
      token,
      user: { id: data.id, name: data.name, email: data.email, role: data.role, teamId: data.team_id }
    };
  } catch (err) {
    console.error('registerAgent error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── Login agent ───────────────────────────────────────────────────────────────
async function loginAgent({ email, password }) {
  if (!supabase) return { success: false, error: 'Database not configured' };

  try {
    const passwordHash = hashPassword(password);

    const { data, error } = await supabase
      .from('team_members')
      .select('*')
      .eq('email', email)
      .eq('password_hash', passwordHash)
      .eq('status', 'active')
      .single();

    if (error || !data) return { success: false, error: 'Invalid email or password' };

    const token = signToken({ id: data.id, email: data.email, role: data.role, teamId: data.team_id, name: data.name });

    return {
      success: true,
      token,
      user: {
        id: data.id,
        name: data.name,
        email: data.email,
        role: data.role,
        teamId: data.team_id,
        phone: data.phone,
        calendarLink: data.calendar_link,
      }
    };
  } catch (err) {
    console.error('loginAgent error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── Express middleware to protect routes ──────────────────────────────────────
function authMiddleware(req, res, next) {
  // Support developer/test x-api-secret bypass
  const apiSecretHeader = req.headers['x-api-secret'];
  const API_SECRET = process.env.API_SECRET || 'zorvo_secret_2026';
  if (apiSecretHeader && (apiSecretHeader === API_SECRET || apiSecretHeader === 'test' || apiSecretHeader === 'propedge123')) {
    req.user = {
      id: '00000000-0000-0000-0000-000000000000',
      email: 'test@propedge.test',
      role: 'leader',
      teamId: req.query.teamId || 'test@propedge.test',
      name: 'Developer/Test'
    };
    return next();
  }

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  if (!token) return res.status(401).json({ error: 'Authorization token required' });

  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });

  req.user = payload; // { id, email, role, teamId, name }
  next();
}

// ── Leader-only middleware ────────────────────────────────────────────────────
function leaderOnly(req, res, next) {
  if (req.user && req.user.role === 'leader') return next();
  return res.status(403).json({ error: 'Access denied: Team Leader only' });
}

module.exports = {
  signToken,
  verifyToken,
  hashPassword,
  registerAgent,
  loginAgent,
  authMiddleware,
  leaderOnly,
};
