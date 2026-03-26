const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORE_PATH = path.join(__dirname, '..', 'data', 'store.json');
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_STATE_TABLE = process.env.SUPABASE_STATE_TABLE || 'app_state';
const SUPABASE_STATE_ROW_ID = process.env.SUPABASE_STATE_ROW_ID || 'primary';

const defaultState = {
  users: [],
  sessions: [],
  charities: [
    {
      id: 'c1',
      name: 'First Tee',
      description: 'Youth golf and life skills through golf access, coaching, and mentorship.',
      featured: true,
      isActive: true,
      imageUrl: '',
      upcomingEvents: ['Spring Skills Camp', 'Junior Community Challenge'],
      createdAt: new Date().toISOString()
    },
    {
      id: 'c2',
      name: 'Golf For Good',
      description: 'Community golf development and inclusion programmes for underserved players.',
      featured: false,
      isActive: true,
      imageUrl: '',
      upcomingEvents: ['Summer Charity Fourball'],
      createdAt: new Date().toISOString()
    }
  ],
  subscriptions: [],
  scores: [],
  draws: [],
  drawEntries: [],
  prizePoolSnapshots: [],
  winners: [],
  donations: [],
  auditLogs: []
};

function ensureStore() {
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(defaultState, null, 2));
  }
}

function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function mergeWithDefaults(raw) {
  return {
    ...defaultState,
    ...raw,
    charities: raw.charities || defaultState.charities,
    subscriptions: raw.subscriptions || [],
    scores: raw.scores || [],
    draws: raw.draws || [],
    drawEntries: raw.drawEntries || [],
    prizePoolSnapshots: raw.prizePoolSnapshots || [],
    winners: raw.winners || [],
    donations: raw.donations || [],
    auditLogs: raw.auditLogs || []
  };
}

async function supabaseRequest(method, query = '', body) {
  const endpoint = `${SUPABASE_URL}/rest/v1/${SUPABASE_STATE_TABLE}${query}`;
  const response = await fetch(endpoint, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation,resolution=merge-duplicates'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${message}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function readStore() {
  ensureStore();
  const localRaw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  const localState = mergeWithDefaults(localRaw);

  if (!isSupabaseConfigured()) return localState;

  try {
    const rows = await supabaseRequest('GET', `?id=eq.${encodeURIComponent(SUPABASE_STATE_ROW_ID)}&select=state`);
    if (!Array.isArray(rows) || !rows.length) {
      await supabaseRequest('POST', '', [{ id: SUPABASE_STATE_ROW_ID, state: localState }]);
      return localState;
    }

    const remoteState = mergeWithDefaults(rows[0].state || {});
    fs.writeFileSync(STORE_PATH, JSON.stringify(remoteState, null, 2));
    return remoteState;
  } catch (error) {
    console.warn(`Supabase read failed, using local store: ${error.message}`);
    return localState;
  }
}

async function writeStore(state) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2));

  if (!isSupabaseConfigured()) return;

  try {
    await supabaseRequest('POST', '', [{ id: SUPABASE_STATE_ROW_ID, state }]);
  } catch (error) {
    console.warn(`Supabase write failed, local store retained: ${error.message}`);
  }
}

function id(prefix = '') {
  return `${prefix}${crypto.randomUUID()}`;
}

function hash(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

module.exports = { readStore, writeStore, id, hash };
