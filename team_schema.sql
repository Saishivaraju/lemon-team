-- ─────────────────────────────────────────────────────────────────────────────
-- ZORVO TEAM EDITION — Supabase Database Schema
-- Run this in your Supabase SQL editor to create all required tables
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. TEAMS TABLE
CREATE TABLE IF NOT EXISTS teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- 2. TEAM MEMBERS TABLE (Leaders + Agents)
CREATE TABLE IF NOT EXISTS team_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  phone           TEXT,
  role            TEXT CHECK (role IN ('leader', 'agent')) DEFAULT 'agent',
  team_id         UUID REFERENCES teams(id),
  calendar_link   TEXT,
  status          TEXT DEFAULT 'active',  -- active | inactive
  leads_assigned  INT DEFAULT 0,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- 3. TEAM INVITES TABLE (Leader invites agents by email)
CREATE TABLE IF NOT EXISTS team_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID REFERENCES teams(id),
  invited_by  UUID REFERENCES team_members(id),
  email       TEXT NOT NULL,
  token       TEXT UNIQUE NOT NULL,
  status      TEXT DEFAULT 'pending',  -- pending | accepted | expired
  created_at  TIMESTAMP DEFAULT NOW(),
  expires_at  TIMESTAMP DEFAULT (NOW() + INTERVAL '7 days')
);

-- 4. UPDATE team_leads TABLE — Add agent_id + team_id ownership tags
-- (This is the core change: every lead now knows which agent owns it)
ALTER TABLE team_leads
  ADD COLUMN IF NOT EXISTS agent_id    UUID REFERENCES team_members(id),
  ADD COLUMN IF NOT EXISTS team_id     UUID REFERENCES teams(id),
  ADD COLUMN IF NOT EXISTS ai_score    TEXT CHECK (ai_score IN ('HOT', 'WARM', 'COLD')),
  ADD COLUMN IF NOT EXISTS ai_notes    TEXT,
  ADD COLUMN IF NOT EXISTS ai_summary  TEXT,
  ADD COLUMN IF NOT EXISTS source      TEXT DEFAULT 'Website';

-- 5. UPDATE properties TABLE — Add agent_id + team_id ownership tags
-- (Every property now knows which agent listed it)
CREATE TABLE IF NOT EXISTS team_properties (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          UUID REFERENCES team_members(id),
  team_id           UUID REFERENCES teams(id),
  name              TEXT NOT NULL,
  property_type     TEXT,
  location          TEXT,
  address           TEXT,
  price             NUMERIC,
  price_label       TEXT,
  bedrooms          INT,
  bathrooms         INT,
  area_sqft         NUMERIC,
  description       TEXT,
  status            TEXT DEFAULT 'available',   -- available | sold | rented
  -- AI knowledge fields (fed into the AI call prompt)
  neighborhood_info TEXT,     -- Nearby schools, stores, transport
  financing_options TEXT,     -- Loan types, down payment, HOA
  key_selling_points TEXT,    -- What makes this property special
  features          TEXT[],   -- Array of features
  images            TEXT[],   -- Array of image URLs
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

-- 6. CALL LOGS TABLE (linked to agent + lead)
CREATE TABLE IF NOT EXISTS team_call_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       UUID,
  agent_id      UUID REFERENCES team_members(id),
  team_id       UUID REFERENCES teams(id),
  phone         TEXT,
  vapi_call_id  TEXT,
  status        TEXT,       -- answered | no_answer | failed | transferred
  ai_score      TEXT,       -- HOT | WARM | COLD
  duration_sec  INT DEFAULT 0,
  transcript    TEXT,
  recording_url TEXT,
  summary       TEXT,
  called_at     TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES for performance
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_team_members_team_id  ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_leads_agent_id   ON team_leads(agent_id);
CREATE INDEX IF NOT EXISTS idx_team_leads_team_id    ON team_leads(team_id);
CREATE INDEX IF NOT EXISTS idx_team_props_agent_id   ON team_properties(agent_id);
CREATE INDEX IF NOT EXISTS idx_team_call_agent_id    ON team_call_logs(agent_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY (Optional but recommended)
-- ─────────────────────────────────────────────────────────────────────────────
-- Enable RLS on sensitive tables
ALTER TABLE team_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_leads      ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_call_logs  ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROUND ROBIN TRACKING TABLE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_round_robin (
  team_id        UUID PRIMARY KEY REFERENCES teams(id),
  last_agent_idx INT DEFAULT 0,
  updated_at     TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- DONE! Tables created successfully.
-- Next step: Run your backend server and call POST /api/team/register-leader
-- to create your Team Leader account and your first team.
-- ─────────────────────────────────────────────────────────────────────────────
