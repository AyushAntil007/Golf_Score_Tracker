const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { readStore, writeStore, id, hash } = require('./store');

const DEFAULT_PORT = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, '..', 'public');

const PLAN_PRICING = {
  monthly: 25,
  yearly: 250
};

const DRAW_POOL_SPLIT = {
  5: 0.4,
  4: 0.35,
  3: 0.25
};

let currentPort = DEFAULT_PORT;

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, payload, headers = {}) {
  res.writeHead(status, headers);
  res.end(payload);
}

async function parseJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name || ''
  };
}

function getMonthKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function isValidDateInput(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function addMonths(dateInput, months) {
  const date = new Date(dateInput);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date;
}

function getCharity(db, charityId) {
  return db.charities.find((charity) => charity.id === charityId && charity.isActive !== false);
}

function getSubscriptionByUser(db, userId) {
  return db.subscriptions.find((subscription) => subscription.userId === userId);
}

function normalizeSubscription(subscription) {
  if (!subscription) return null;

  if (subscription.status === 'active' && subscription.renewalDate) {
    const renewalDate = new Date(`${subscription.renewalDate}T23:59:59.999Z`);
    if (renewalDate.getTime() < Date.now()) {
      subscription.status = subscription.cancelAtPeriodEnd ? 'canceled' : 'inactive';
    }
  }

  return subscription;
}

function getSubscriptionState(db, userId) {
  const subscription = normalizeSubscription(getSubscriptionByUser(db, userId));
  return subscription || null;
}

function logAdminAction(db, adminId, action, entity, entityId, metadata = {}) {
  db.auditLogs.push({
    id: id('audit_'),
    adminId,
    action,
    entity,
    entityId: entityId || null,
    metadata,
    createdAt: new Date().toISOString()
  });
}

async function auth(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return { error: 'Missing token' };

  const db = await readStore();
  const session = db.sessions.find((entry) => entry.token === token);
  if (!session) return { error: 'Invalid token' };

  const user = db.users.find((entry) => entry.id === session.userId);
  if (!user) return { error: 'Invalid user' };

  normalizeSubscription(getSubscriptionByUser(db, user.id));
  await writeStore(db);

  return { db, user };
}

function requireAdmin(ctx) {
  return ctx.user && ctx.user.role === 'admin';
}

function requireActiveSubscription(ctx) {
  const subscription = getSubscriptionState(ctx.db, ctx.user.id);
  if (!subscription || subscription.status !== 'active') {
    return { error: 'Active subscription required' };
  }

  return { subscription };
}

function getUserScores(db, userId) {
  return db.scores
    .filter((score) => score.userId === userId)
    .sort((a, b) => {
      const playedDiff = new Date(a.playedOn) - new Date(b.playedOn);
      if (playedDiff !== 0) return playedDiff;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
}

function getUserScoresDescending(db, userId) {
  return getUserScores(db, userId).slice().sort((a, b) => {
    const playedDiff = new Date(b.playedOn) - new Date(a.playedOn);
    if (playedDiff !== 0) return playedDiff;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

function enforceLatestFiveScores(db, userId) {
  const ordered = getUserScores(db, userId);
  while (ordered.length > 5) {
    const oldest = ordered.shift();
    db.scores = db.scores.filter((score) => score.id !== oldest.id);
  }
}

function pickNumbersRandom() {
  const values = new Set();
  while (values.size < 5) values.add(Math.floor(Math.random() * 45) + 1);
  return [...values].sort((a, b) => a - b);
}

function pickNumbersAlgorithmic(scores) {
  if (!scores.length) return pickNumbersRandom();

  const frequency = new Map();
  for (const row of scores) {
    frequency.set(row.score, (frequency.get(row.score) || 0) + 1);
  }

  const weighted = [...frequency.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0] - b[0];
    })
    .map(([score]) => score);

  while (weighted.length < 5) {
    const candidate = Math.floor(Math.random() * 45) + 1;
    if (!weighted.includes(candidate)) weighted.push(candidate);
  }

  return weighted.slice(0, 5).sort((a, b) => a - b);
}

function countMatches(userNumbers, drawNumbers) {
  const drawSet = new Set(drawNumbers);
  return userNumbers.filter((value) => drawSet.has(value)).length;
}

function getPreviousRollover(db, monthKey) {
  return db.prizePoolSnapshots
    .filter((snapshot) => snapshot.monthKey !== monthKey)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .find((snapshot) => snapshot.rolloverCarryForward > 0)?.rolloverCarryForward || 0;
}

function getPrizePoolSnapshot(db, drawId) {
  return db.prizePoolSnapshots.find((snapshot) => snapshot.drawId === drawId) || null;
}

function buildPrizePool(activeSubscriptions, rolloverAmount) {
  const totalSubscriptionValue = activeSubscriptions.reduce((sum, subscription) => {
    return sum + (PLAN_PRICING[subscription.plan] || 0);
  }, 0);

  const prizePoolBase = Number((totalSubscriptionValue * 0.4).toFixed(2));
  const pool5 = Number((prizePoolBase * DRAW_POOL_SPLIT[5] + rolloverAmount).toFixed(2));
  const pool4 = Number((prizePoolBase * DRAW_POOL_SPLIT[4]).toFixed(2));
  const pool3 = Number((prizePoolBase * DRAW_POOL_SPLIT[3]).toFixed(2));

  return {
    activeSubscribers: activeSubscriptions.length,
    subscriptionRevenue: Number(totalSubscriptionValue.toFixed(2)),
    totalPoolBase: prizePoolBase,
    totalPoolWithRollover: Number((pool5 + pool4 + pool3).toFixed(2)),
    pool5,
    pool4,
    pool3,
    rolloverFromPrevious: Number(rolloverAmount.toFixed(2))
  };
}

function buildSubscriberDashboard(db, user) {
  const subscription = getSubscriptionState(db, user.id);
  const scores = getUserScoresDescending(db, user.id);
  const charity = subscription ? getCharity(db, subscription.charityId) : null;
  const winners = db.winners.filter((winner) => winner.userId === user.id);
  const draws = db.draws
    .filter((draw) => draw.status === 'published')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return {
    user: sanitizeUser(user),
    subscription,
    selectedCharity: charity,
    scores,
    participation: {
      completedDraws: draws.length,
      upcomingDraws: 1,
      eligibleForNextDraw: Boolean(subscription && subscription.status === 'active' && scores.length === 5)
    },
    winnings: {
      totalWon: Number(winners.reduce((sum, winner) => sum + winner.prizeAmount, 0).toFixed(2)),
      pendingVerification: winners.filter((winner) => winner.verificationStatus === 'pending').length,
      pendingPayout: winners.filter((winner) => winner.payoutStatus === 'pending').length
    },
    winners
  };
}

function buildAdminDashboard(db) {
  const activeSubscriptions = db.subscriptions.filter((subscription) => normalizeSubscription(subscription)?.status === 'active');
  const totalPrizePool = db.prizePoolSnapshots.reduce((sum, snapshot) => sum + snapshot.totalPoolWithRollover, 0);
  const totalCharityContributions = db.donations
    .filter((donation) => donation.source === 'subscription')
    .reduce((sum, donation) => sum + donation.amount, 0);

  return {
    totals: {
      users: db.users.length,
      activeSubscribers: activeSubscriptions.length,
      charities: db.charities.filter((charity) => charity.isActive !== false).length,
      draws: db.draws.length,
      totalPrizePool: Number(totalPrizePool.toFixed(2)),
      charityContributions: Number(totalCharityContributions.toFixed(2))
    },
    subscriptions: db.subscriptions,
    recentDraws: db.draws.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6),
    winners: db.winners.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 10)
  };
}

function serveStatic(req, res, pathname) {
  const target = pathname === '/' ? path.join(publicDir, 'index.html') : path.join(publicDir, pathname);
  if (!target.startsWith(publicDir) || !fs.existsSync(target)) return false;

  const extension = path.extname(target);
  const contentType =
    extension === '.html' ? 'text/html' :
    extension === '.js' ? 'text/javascript' :
    extension === '.css' ? 'text/css' :
    'text/plain';

  sendText(res, 200, fs.readFileSync(target), { 'Content-Type': contentType });
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) {
    if (serveStatic(req, res, pathname)) return;
    return sendJson(res, 404, { error: 'Not found' });
  }

  if (req.method === 'POST' && pathname === '/api/auth/signup') {
    const body = await parseJson(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const name = String(body.name || '').trim();
    const role = body.role === 'admin' ? 'admin' : 'subscriber';

    if (!email || !password) return sendJson(res, 400, { error: 'email + password required' });

    const db = await readStore();
    if (db.users.some((user) => user.email.toLowerCase() === email)) {
      return sendJson(res, 409, { error: 'Email already in use' });
    }

    const defaultCharity = db.charities.find((charity) => charity.isActive !== false) || db.charities[0] || null;
    const user = {
      id: id('u_'),
      email,
      name,
      passwordHash: hash(password),
      role,
      createdAt: new Date().toISOString()
    };

    db.users.push(user);
    db.subscriptions.push({
      userId: user.id,
      plan: null,
      status: 'inactive',
      renewalDate: null,
      charityPercent: 10,
      charityId: defaultCharity ? defaultCharity.id : null,
      cancelAtPeriodEnd: false,
      gateway: 'demo',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    await writeStore(db);

    return sendJson(res, 201, sanitizeUser(user));
  }

  if (req.method === 'POST' && pathname === '/api/auth/login') {
    const body = await parseJson(req);
    const db = await readStore();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const user = db.users.find((entry) => entry.email.toLowerCase() === email);

    if (!user || user.passwordHash !== hash(password)) {
      return sendJson(res, 401, { error: 'Invalid credentials' });
    }

    const token = id('t_');
    db.sessions.push({
      token,
      userId: user.id,
      createdAt: new Date().toISOString()
    });
    await writeStore(db);

    return sendJson(res, 200, {
      token,
      user: sanitizeUser(user),
      subscription: getSubscriptionState(db, user.id)
    });
  }

  if (req.method === 'GET' && pathname === '/api/charities') {
    const db = await readStore();
    const featuredOnly = url.searchParams.get('featured') === 'true';
    const search = String(url.searchParams.get('search') || '').trim().toLowerCase();

    let charities = db.charities.filter((charity) => charity.isActive !== false);
    if (featuredOnly) charities = charities.filter((charity) => charity.featured);
    if (search) {
      charities = charities.filter((charity) => {
        return charity.name.toLowerCase().includes(search) || String(charity.description || '').toLowerCase().includes(search);
      });
    }

    return sendJson(res, 200, charities);
  }

  if (req.method === 'GET' && pathname.match(/^\/api\/charities\/[^/]+$/)) {
    const db = await readStore();
    const charityId = pathname.split('/')[3];
    const charity = getCharity(db, charityId);
    if (!charity) return sendJson(res, 404, { error: 'Charity not found' });

    const donations = db.donations.filter((donation) => donation.charityId === charity.id);
    return sendJson(res, 200, {
      ...charity,
      totalRaised: Number(donations.reduce((sum, donation) => sum + donation.amount, 0).toFixed(2)),
      donationCount: donations.length
    });
  }

  if (req.method === 'GET' && pathname === '/api/me') {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });

    return sendJson(res, 200, buildSubscriberDashboard(ctx.db, ctx.user));
  }

  if (req.method === 'PATCH' && pathname === '/api/me') {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });

    const body = await parseJson(req);
    ctx.user.name = String(body.name || ctx.user.name || '').trim();
    await writeStore(ctx.db);

    return sendJson(res, 200, { user: sanitizeUser(ctx.user) });
  }

  if (req.method === 'GET' && pathname === '/api/dashboard') {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });
    return sendJson(res, 200, buildSubscriberDashboard(ctx.db, ctx.user));
  }

  if (req.method === 'GET' && pathname === '/api/subscriptions/current') {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });

    return sendJson(res, 200, { subscription: getSubscriptionState(ctx.db, ctx.user.id) });
  }

  if (req.method === 'POST' && pathname === '/api/subscriptions/activate') {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });

    const body = await parseJson(req);
    const plan = body.plan;
    const charityPercent = Number(body.charityPercent);
    const charityId = body.charityId;

    if (!Object.prototype.hasOwnProperty.call(PLAN_PRICING, plan)) {
      return sendJson(res, 400, { error: 'Invalid plan' });
    }
    if (!Number.isFinite(charityPercent) || charityPercent < 10 || charityPercent > 100) {
      return sendJson(res, 400, { error: 'Charity contribution must be between 10 and 100' });
    }
    if (charityId && !getCharity(ctx.db, charityId)) {
      return sendJson(res, 400, { error: 'Invalid charity' });
    }

    const subscription = getSubscriptionByUser(ctx.db, ctx.user.id);
    const now = new Date();
    const renewalDate = addMonths(now, plan === 'monthly' ? 1 : 12).toISOString().slice(0, 10);

    subscription.plan = plan;
    subscription.status = 'active';
    subscription.renewalDate = renewalDate;
    subscription.cancelAtPeriodEnd = false;
    subscription.charityPercent = charityPercent;
    subscription.charityId = charityId || subscription.charityId;
    subscription.updatedAt = now.toISOString();

    const price = PLAN_PRICING[plan];
    const charityAmount = Number(((price * charityPercent) / 100).toFixed(2));
    ctx.db.donations.push({
      id: id('don_'),
      userId: ctx.user.id,
      charityId: subscription.charityId,
      amount: charityAmount,
      source: 'subscription',
      createdAt: now.toISOString()
    });

    await writeStore(ctx.db);
    return sendJson(res, 200, {
      subscription,
      contribution: {
        charityAmount,
        price,
        currency: 'GBP'
      }
    });
  }

  if (req.method === 'POST' && pathname === '/api/subscriptions/cancel') {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });

    const subscription = getSubscriptionByUser(ctx.db, ctx.user.id);
    if (!subscription || subscription.status === 'inactive') {
      return sendJson(res, 400, { error: 'No active subscription to cancel' });
    }

    subscription.cancelAtPeriodEnd = true;
    subscription.updatedAt = new Date().toISOString();
    await writeStore(ctx.db);

    return sendJson(res, 200, { subscription });
  }

  if (req.method === 'POST' && pathname === '/api/me/charity-preference') {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });

    const body = await parseJson(req);
    const charityId = body.charityId;
    const charityPercent = Number(body.charityPercent);

    if (!getCharity(ctx.db, charityId)) return sendJson(res, 400, { error: 'Invalid charity' });
    if (!Number.isFinite(charityPercent) || charityPercent < 10 || charityPercent > 100) {
      return sendJson(res, 400, { error: 'Charity contribution must be between 10 and 100' });
    }

    const subscription = getSubscriptionByUser(ctx.db, ctx.user.id);
    subscription.charityId = charityId;
    subscription.charityPercent = charityPercent;
    subscription.updatedAt = new Date().toISOString();
    await writeStore(ctx.db);

    return sendJson(res, 200, { subscription });
  }

  if (req.method === 'POST' && pathname === '/api/donations') {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });

    const body = await parseJson(req);
    const charityId = body.charityId;
    const amount = Number(body.amount);

    if (!getCharity(ctx.db, charityId)) return sendJson(res, 400, { error: 'Invalid charity' });
    if (!Number.isFinite(amount) || amount <= 0) return sendJson(res, 400, { error: 'Amount must be greater than 0' });

    const donation = {
      id: id('don_'),
      userId: ctx.user.id,
      charityId,
      amount: Number(amount.toFixed(2)),
      source: 'independent',
      createdAt: new Date().toISOString()
    };
    ctx.db.donations.push(donation);
    await writeStore(ctx.db);

    return sendJson(res, 201, donation);
  }

  if (req.method === 'GET' && pathname === '/api/scores') {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });

    return sendJson(res, 200, getUserScoresDescending(ctx.db, ctx.user.id));
  }

  if (req.method === 'POST' && pathname === '/api/scores') {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });

    const subscriptionCheck = requireActiveSubscription(ctx);
    if (subscriptionCheck.error) return sendJson(res, 403, { error: subscriptionCheck.error });

    const body = await parseJson(req);
    const score = Number(body.score);
    const playedOn = body.playedOn;

    if (!Number.isInteger(score) || score < 1 || score > 45) {
      return sendJson(res, 400, { error: 'Score must be an integer between 1 and 45' });
    }
    if (!isValidDateInput(playedOn)) {
      return sendJson(res, 400, { error: 'playedOn date is required in YYYY-MM-DD format' });
    }

    const newScore = {
      id: id('s_'),
      userId: ctx.user.id,
      score,
      playedOn,
      createdAt: new Date().toISOString()
    };
    ctx.db.scores.push(newScore);
    enforceLatestFiveScores(ctx.db, ctx.user.id);
    await writeStore(ctx.db);

    return sendJson(res, 201, {
      message: 'Score added',
      score: newScore,
      latestScores: getUserScoresDescending(ctx.db, ctx.user.id)
    });
  }

  if (req.method === 'PATCH' && pathname.match(/^\/api\/scores\/[^/]+$/)) {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });

    const subscriptionCheck = requireActiveSubscription(ctx);
    if (subscriptionCheck.error) return sendJson(res, 403, { error: subscriptionCheck.error });

    const scoreId = pathname.split('/')[3];
    const record = ctx.db.scores.find((score) => score.id === scoreId && score.userId === ctx.user.id);
    if (!record) return sendJson(res, 404, { error: 'Score not found' });

    const body = await parseJson(req);
    if (body.score !== undefined) {
      const nextScore = Number(body.score);
      if (!Number.isInteger(nextScore) || nextScore < 1 || nextScore > 45) {
        return sendJson(res, 400, { error: 'Score must be an integer between 1 and 45' });
      }
      record.score = nextScore;
    }
    if (body.playedOn !== undefined) {
      if (!isValidDateInput(body.playedOn)) {
        return sendJson(res, 400, { error: 'playedOn date is required in YYYY-MM-DD format' });
      }
      record.playedOn = body.playedOn;
    }

    enforceLatestFiveScores(ctx.db, ctx.user.id);
    await writeStore(ctx.db);
    return sendJson(res, 200, { score: record, latestScores: getUserScoresDescending(ctx.db, ctx.user.id) });
  }

  if (req.method === 'DELETE' && pathname.match(/^\/api\/scores\/[^/]+$/)) {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });

    const scoreId = pathname.split('/')[3];
    const beforeCount = ctx.db.scores.length;
    ctx.db.scores = ctx.db.scores.filter((score) => !(score.id === scoreId && score.userId === ctx.user.id));
    if (beforeCount === ctx.db.scores.length) return sendJson(res, 404, { error: 'Score not found' });

    await writeStore(ctx.db);
    return sendJson(res, 200, { message: 'Score deleted', latestScores: getUserScoresDescending(ctx.db, ctx.user.id) });
  }

  if (req.method === 'GET' && pathname === '/api/draws/upcoming') {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });

    const monthKey = getMonthKey();
    const current = ctx.db.draws.find((draw) => draw.monthKey === monthKey);
    const eligibleNumbers = getUserScoresDescending(ctx.db, ctx.user.id).slice(0, 5).map((score) => score.score).sort((a, b) => a - b);

    return sendJson(res, 200, {
      monthKey,
      configuredDraw: current || null,
      userNumbers: eligibleNumbers,
      eligible: eligibleNumbers.length === 5 && getSubscriptionState(ctx.db, ctx.user.id)?.status === 'active'
    });
  }

  if (req.method === 'GET' && pathname === '/api/draws/history') {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });

    return sendJson(res, 200, ctx.db.draws
      .filter((draw) => draw.status === 'published')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  }

  if (req.method === 'GET' && pathname.match(/^\/api\/draws\/[^/]+\/result$/)) {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });

    const drawId = pathname.split('/')[3];
    const draw = ctx.db.draws.find((entry) => entry.id === drawId);
    if (!draw) return sendJson(res, 404, { error: 'Draw not found' });

    return sendJson(res, 200, {
      draw,
      winners: ctx.db.winners.filter((winner) => winner.drawId === drawId),
      entries: ctx.db.drawEntries.filter((entry) => entry.drawId === drawId),
      prizePool: getPrizePoolSnapshot(ctx.db, drawId)
    });
  }

  if (req.method === 'GET' && pathname === '/api/draws') {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });

    return sendJson(res, 200, ctx.db.draws.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  }

  if (req.method === 'POST' && pathname === '/api/admin/charities') {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });
    if (!requireAdmin(ctx)) return sendJson(res, 403, { error: 'Admin only' });

    const body = await parseJson(req);
    if (!String(body.name || '').trim()) return sendJson(res, 400, { error: 'name required' });

    const charity = {
      id: id('c_'),
      name: String(body.name).trim(),
      description: String(body.description || '').trim(),
      featured: Boolean(body.featured),
      isActive: body.isActive !== false,
      imageUrl: String(body.imageUrl || '').trim(),
      upcomingEvents: Array.isArray(body.upcomingEvents) ? body.upcomingEvents.slice(0, 5) : [],
      createdAt: new Date().toISOString()
    };
    ctx.db.charities.push(charity);
    logAdminAction(ctx.db, ctx.user.id, 'create', 'charity', charity.id, { name: charity.name });
    await writeStore(ctx.db);

    return sendJson(res, 201, charity);
  }

  if (req.method === 'PATCH' && pathname.match(/^\/api\/admin\/charities\/[^/]+$/)) {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });
    if (!requireAdmin(ctx)) return sendJson(res, 403, { error: 'Admin only' });

    const charityId = pathname.split('/')[4];
    const charity = ctx.db.charities.find((entry) => entry.id === charityId);
    if (!charity) return sendJson(res, 404, { error: 'Charity not found' });

    const body = await parseJson(req);
    if (body.name !== undefined) charity.name = String(body.name || charity.name).trim();
    if (body.description !== undefined) charity.description = String(body.description || '').trim();
    if (body.featured !== undefined) charity.featured = Boolean(body.featured);
    if (body.isActive !== undefined) charity.isActive = Boolean(body.isActive);
    if (body.imageUrl !== undefined) charity.imageUrl = String(body.imageUrl || '').trim();
    if (body.upcomingEvents !== undefined) charity.upcomingEvents = Array.isArray(body.upcomingEvents) ? body.upcomingEvents.slice(0, 5) : [];

    logAdminAction(ctx.db, ctx.user.id, 'update', 'charity', charity.id);
    await writeStore(ctx.db);
    return sendJson(res, 200, charity);
  }

  if (req.method === 'DELETE' && pathname.match(/^\/api\/admin\/charities\/[^/]+$/)) {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });
    if (!requireAdmin(ctx)) return sendJson(res, 403, { error: 'Admin only' });

    const charityId = pathname.split('/')[4];
    const charity = ctx.db.charities.find((entry) => entry.id === charityId);
    if (!charity) return sendJson(res, 404, { error: 'Charity not found' });

    charity.isActive = false;
    charity.featured = false;
    logAdminAction(ctx.db, ctx.user.id, 'archive', 'charity', charity.id);
    await writeStore(ctx.db);
    return sendJson(res, 200, charity);
  }

  if (req.method === 'GET' && pathname === '/api/admin/users') {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });
    if (!requireAdmin(ctx)) return sendJson(res, 403, { error: 'Admin only' });

    const users = ctx.db.users.map((user) => ({
      ...sanitizeUser(user),
      subscription: getSubscriptionState(ctx.db, user.id),
      scoreCount: ctx.db.scores.filter((score) => score.userId === user.id).length,
      totalWon: Number(ctx.db.winners.filter((winner) => winner.userId === user.id).reduce((sum, winner) => sum + winner.prizeAmount, 0).toFixed(2))
    }));

    return sendJson(res, 200, users);
  }

  if (req.method === 'PATCH' && pathname.match(/^\/api\/admin\/users\/[^/]+$/)) {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });
    if (!requireAdmin(ctx)) return sendJson(res, 403, { error: 'Admin only' });

    const userId = pathname.split('/')[4];
    const user = ctx.db.users.find((entry) => entry.id === userId);
    if (!user) return sendJson(res, 404, { error: 'User not found' });

    const body = await parseJson(req);
    if (body.name !== undefined) user.name = String(body.name || '').trim();
    if (body.role !== undefined && ['subscriber', 'admin'].includes(body.role)) user.role = body.role;
    logAdminAction(ctx.db, ctx.user.id, 'update', 'user', user.id);
    await writeStore(ctx.db);

    return sendJson(res, 200, sanitizeUser(user));
  }

  if (req.method === 'PATCH' && pathname.match(/^\/api\/admin\/subscriptions\/[^/]+$/)) {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });
    if (!requireAdmin(ctx)) return sendJson(res, 403, { error: 'Admin only' });

    const userId = pathname.split('/')[4];
    const subscription = getSubscriptionByUser(ctx.db, userId);
    if (!subscription) return sendJson(res, 404, { error: 'Subscription not found' });

    const body = await parseJson(req);
    if (body.plan !== undefined && Object.prototype.hasOwnProperty.call(PLAN_PRICING, body.plan)) subscription.plan = body.plan;
    if (body.status !== undefined && ['inactive', 'active', 'past_due', 'canceled', 'incomplete'].includes(body.status)) subscription.status = body.status;
    if (body.renewalDate !== undefined && (body.renewalDate === null || isValidDateInput(body.renewalDate))) subscription.renewalDate = body.renewalDate;
    if (body.charityPercent !== undefined) {
      const charityPercent = Number(body.charityPercent);
      if (!Number.isFinite(charityPercent) || charityPercent < 10 || charityPercent > 100) {
        return sendJson(res, 400, { error: 'Charity contribution must be between 10 and 100' });
      }
      subscription.charityPercent = charityPercent;
    }
    if (body.charityId !== undefined) {
      if (!getCharity(ctx.db, body.charityId)) return sendJson(res, 400, { error: 'Invalid charity' });
      subscription.charityId = body.charityId;
    }

    subscription.updatedAt = new Date().toISOString();
    logAdminAction(ctx.db, ctx.user.id, 'update', 'subscription', userId, { status: subscription.status });
    await writeStore(ctx.db);
    return sendJson(res, 200, subscription);
  }

  if (req.method === 'POST' && pathname === '/api/admin/draws/simulate') {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });
    if (!requireAdmin(ctx)) return sendJson(res, 403, { error: 'Admin only' });

    const body = await parseJson(req);
    const mode = body.mode || 'random';
    const monthKey = body.monthKey || getMonthKey();
    if (!['random', 'algorithmic'].includes(mode)) return sendJson(res, 400, { error: 'Invalid mode' });

    const existingPublished = ctx.db.draws.find((draw) => draw.monthKey === monthKey && draw.status === 'published');
    if (existingPublished) {
      return sendJson(res, 409, { error: 'A draw for this month has already been published' });
    }

    const numbers = mode === 'random' ? pickNumbersRandom() : pickNumbersAlgorithmic(ctx.db.scores);
    const activeSubscriptions = ctx.db.subscriptions.filter((subscription) => normalizeSubscription(subscription)?.status === 'active');
    const rolloverAmount = getPreviousRollover(ctx.db, monthKey);
    const prizePool = buildPrizePool(activeSubscriptions, rolloverAmount);

    const draw = {
      id: id('d_'),
      monthKey,
      mode,
      status: 'simulated',
      numbers,
      createdBy: ctx.user.id,
      createdAt: new Date().toISOString()
    };
    ctx.db.draws.push(draw);
    ctx.db.prizePoolSnapshots.push({
      id: id('pps_'),
      drawId: draw.id,
      monthKey,
      activeSubscribers: prizePool.activeSubscribers,
      subscriptionRevenue: prizePool.subscriptionRevenue,
      totalPoolBase: prizePool.totalPoolBase,
      totalPoolWithRollover: prizePool.totalPoolWithRollover,
      pool5: prizePool.pool5,
      pool4: prizePool.pool4,
      pool3: prizePool.pool3,
      rolloverFromPrevious: prizePool.rolloverFromPrevious,
      rolloverCarryForward: 0,
      createdAt: new Date().toISOString()
    });

    logAdminAction(ctx.db, ctx.user.id, 'simulate', 'draw', draw.id, { monthKey, mode, numbers });
    await writeStore(ctx.db);
    return sendJson(res, 201, { draw, prizePool: getPrizePoolSnapshot(ctx.db, draw.id) });
  }

  if (req.method === 'POST' && pathname.match(/^\/api\/admin\/draws\/[^/]+\/publish$/)) {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });
    if (!requireAdmin(ctx)) return sendJson(res, 403, { error: 'Admin only' });

    const drawId = pathname.split('/')[4];
    const draw = ctx.db.draws.find((entry) => entry.id === drawId);
    if (!draw) return sendJson(res, 404, { error: 'Draw not found' });
    if (draw.status === 'published') return sendJson(res, 400, { error: 'Draw already published' });

    draw.status = 'published';
    draw.publishedAt = new Date().toISOString();

    const prizePool = getPrizePoolSnapshot(ctx.db, draw.id);
    const activeSubscriptions = ctx.db.subscriptions.filter((subscription) => normalizeSubscription(subscription)?.status === 'active');
    const entries = [];
    const winnersByTier = { 3: [], 4: [], 5: [] };

    for (const subscription of activeSubscriptions) {
      const lastFiveScores = getUserScoresDescending(ctx.db, subscription.userId).slice(0, 5).map((score) => score.score).sort((a, b) => a - b);
      if (lastFiveScores.length < 5) continue;

      const matchCount = countMatches(lastFiveScores, draw.numbers);
      const entry = {
        id: id('entry_'),
        drawId: draw.id,
        userId: subscription.userId,
        numbers: lastFiveScores,
        matchCount,
        createdAt: new Date().toISOString()
      };
      entries.push(entry);
      ctx.db.drawEntries.push(entry);

      if (matchCount >= 3) winnersByTier[matchCount].push(subscription.userId);
    }

    for (const tier of [3, 4, 5]) {
      const users = winnersByTier[tier];
      if (!users.length) continue;

      const totalTierPool = tier === 5 ? prizePool.pool5 : tier === 4 ? prizePool.pool4 : prizePool.pool3;
      const eachPrize = Number((totalTierPool / users.length).toFixed(2));
      for (const userId of users) {
        ctx.db.winners.push({
          id: id('w_'),
          drawId: draw.id,
          userId,
          matchTier: tier,
          prizeAmount: eachPrize,
          verificationStatus: 'pending',
          payoutStatus: 'pending',
          proofUrl: '',
          createdAt: new Date().toISOString()
        });
      }
    }

    prizePool.rolloverCarryForward = winnersByTier[5].length ? 0 : prizePool.pool5;
    logAdminAction(ctx.db, ctx.user.id, 'publish', 'draw', draw.id, {
      entries: entries.length,
      winners: ctx.db.winners.filter((winner) => winner.drawId === draw.id).length
    });
    await writeStore(ctx.db);

    return sendJson(res, 200, {
      draw,
      prizePool,
      entries,
      winners: ctx.db.winners.filter((winner) => winner.drawId === draw.id)
    });
  }

  if (req.method === 'GET' && pathname.match(/^\/api\/admin\/draws\/[^/]+\/winners$/)) {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });
    if (!requireAdmin(ctx)) return sendJson(res, 403, { error: 'Admin only' });

    const drawId = pathname.split('/')[4];
    return sendJson(res, 200, {
      draw: ctx.db.draws.find((draw) => draw.id === drawId) || null,
      winners: ctx.db.winners.filter((winner) => winner.drawId === drawId),
      prizePool: getPrizePoolSnapshot(ctx.db, drawId)
    });
  }

  if (req.method === 'GET' && pathname === '/api/winners/me') {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });
    return sendJson(res, 200, ctx.db.winners.filter((winner) => winner.userId === ctx.user.id));
  }

  if (req.method === 'POST' && pathname.match(/^\/api\/winners\/[^/]+\/proof$/)) {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });

    const winnerId = pathname.split('/')[3];
    const winner = ctx.db.winners.find((entry) => entry.id === winnerId && entry.userId === ctx.user.id);
    if (!winner) return sendJson(res, 404, { error: 'Winner entry not found' });

    const body = await parseJson(req);
    const proofUrl = String(body.proofUrl || '').trim();
    if (!proofUrl) return sendJson(res, 400, { error: 'proofUrl required' });

    winner.proofUrl = proofUrl;
    winner.verificationStatus = 'pending';
    winner.proofSubmittedAt = new Date().toISOString();
    await writeStore(ctx.db);

    return sendJson(res, 200, { message: 'Proof submitted', winner });
  }

  if (req.method === 'POST' && pathname.match(/^\/api\/admin\/winners\/[^/]+\/verify$/)) {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });
    if (!requireAdmin(ctx)) return sendJson(res, 403, { error: 'Admin only' });

    const winnerId = pathname.split('/')[4];
    const winner = ctx.db.winners.find((entry) => entry.id === winnerId);
    if (!winner) return sendJson(res, 404, { error: 'Winner not found' });

    const body = await parseJson(req);
    if (!['approve', 'reject'].includes(body.action)) {
      return sendJson(res, 400, { error: 'action must be approve or reject' });
    }

    winner.verificationStatus = body.action === 'approve' ? 'approved' : 'rejected';
    winner.verifiedBy = ctx.user.id;
    winner.verifiedAt = new Date().toISOString();
    logAdminAction(ctx.db, ctx.user.id, body.action, 'winner', winner.id);
    await writeStore(ctx.db);

    return sendJson(res, 200, winner);
  }

  if (req.method === 'POST' && pathname.match(/^\/api\/admin\/winners\/[^/]+\/mark-paid$/)) {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });
    if (!requireAdmin(ctx)) return sendJson(res, 403, { error: 'Admin only' });

    const winnerId = pathname.split('/')[4];
    const winner = ctx.db.winners.find((entry) => entry.id === winnerId);
    if (!winner) return sendJson(res, 404, { error: 'Winner not found' });
    if (winner.verificationStatus !== 'approved') {
      return sendJson(res, 400, { error: 'Winner must be approved before payout' });
    }

    winner.payoutStatus = 'paid';
    winner.paidAt = new Date().toISOString();
    logAdminAction(ctx.db, ctx.user.id, 'mark_paid', 'winner', winner.id);
    await writeStore(ctx.db);

    return sendJson(res, 200, winner);
  }

  if (req.method === 'GET' && pathname === '/api/admin/dashboard') {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });
    if (!requireAdmin(ctx)) return sendJson(res, 403, { error: 'Admin only' });
    return sendJson(res, 200, buildAdminDashboard(ctx.db));
  }

  if (req.method === 'GET' && pathname === '/api/admin/reports/overview') {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });
    if (!requireAdmin(ctx)) return sendJson(res, 403, { error: 'Admin only' });

    const activeSubscriptions = ctx.db.subscriptions.filter((subscription) => normalizeSubscription(subscription)?.status === 'active');
    const totalPrizePool = ctx.db.prizePoolSnapshots.reduce((sum, snapshot) => sum + snapshot.totalPoolWithRollover, 0);

    return sendJson(res, 200, {
      totalUsers: ctx.db.users.length,
      activeSubscribers: activeSubscriptions.length,
      totalDraws: ctx.db.draws.length,
      publishedDraws: ctx.db.draws.filter((draw) => draw.status === 'published').length,
      totalWinners: ctx.db.winners.length,
      totalPrizePool: Number(totalPrizePool.toFixed(2))
    });
  }

  if (req.method === 'GET' && pathname === '/api/admin/reports/charity-contributions') {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });
    if (!requireAdmin(ctx)) return sendJson(res, 403, { error: 'Admin only' });

    const rows = ctx.db.charities.map((charity) => {
      const donations = ctx.db.donations.filter((donation) => donation.charityId === charity.id);
      return {
        charityId: charity.id,
        charityName: charity.name,
        donationCount: donations.length,
        totalRaised: Number(donations.reduce((sum, donation) => sum + donation.amount, 0).toFixed(2)),
        subscriptionRaised: Number(donations.filter((donation) => donation.source === 'subscription').reduce((sum, donation) => sum + donation.amount, 0).toFixed(2)),
        independentRaised: Number(donations.filter((donation) => donation.source === 'independent').reduce((sum, donation) => sum + donation.amount, 0).toFixed(2))
      };
    });

    return sendJson(res, 200, rows);
  }

  if (req.method === 'GET' && pathname === '/api/admin/reports/draw-stats') {
    const ctx = await auth(req);
    if (ctx.error) return sendJson(res, 401, { error: ctx.error });
    if (!requireAdmin(ctx)) return sendJson(res, 403, { error: 'Admin only' });

    const stats = ctx.db.draws.map((draw) => {
      const winners = ctx.db.winners.filter((winner) => winner.drawId === draw.id);
      const entries = ctx.db.drawEntries.filter((entry) => entry.drawId === draw.id);
      return {
        drawId: draw.id,
        monthKey: draw.monthKey,
        status: draw.status,
        mode: draw.mode,
        numbers: draw.numbers,
        entries: entries.length,
        winners3: winners.filter((winner) => winner.matchTier === 3).length,
        winners4: winners.filter((winner) => winner.matchTier === 4).length,
        winners5: winners.filter((winner) => winner.matchTier === 5).length,
        prizePool: getPrizePoolSnapshot(ctx.db, draw.id)
      };
    });

    return sendJson(res, 200, stats);
  }

  return sendJson(res, 404, { error: 'Not found' });
});

function startServer(port) {
  server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    currentPort += 1;
    console.warn(`Port ${currentPort - 1} is in use. Retrying on port ${currentPort}...`);
    setTimeout(() => startServer(currentPort), 100);
    return;
  }

  throw error;
});

startServer(DEFAULT_PORT);
