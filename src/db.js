const crypto = require('crypto');

// Boots UK Products for random history generation
const BOOTS_PRODUCTS = {
  // Required products (always included in history)
  required: [
    { name: 'Perfecting Finish Loose Powder', price: 4.00 },
    { name: 'No7 Define & Enhance Mascara', price: 12.95 },
    { name: 'Simple Smoothing Facial Scrub', price: 2.25 },
  ],
  // Random products pool
  random: [
    { name: 'No7 Protect & Perfect Intense Advanced Serum', price: 31.00 },
    { name: 'Soap & Glory Clean On Me Body Wash', price: 6.50 },
    { name: 'Boots Cucumber Cleansing Lotion', price: 2.50 },
    { name: 'No7 Radiance+ Energising Exfoliating Cleanser', price: 10.00 },
    { name: 'Soap & Glory The Righteous Butter', price: 9.00 },
    { name: 'No7 Beautiful Skin Hot Cloth Cleanser', price: 9.50 },
    { name: 'Boots Soltan Protect & Moisturise SPF30', price: 6.00 },
    { name: 'No7 Stay Perfect Foundation', price: 16.50 },
    { name: 'Boots Tea Tree & Witch Hazel Facial Wash', price: 2.29 },
    { name: 'No7 Lift & Luminate Triple Action Serum', price: 34.00 },
    { name: 'Soap & Glory Smoothie Star Body Buttercream', price: 9.50 },
    { name: 'Sleek MakeUP i-Divine Eyeshadow Palette', price: 8.99 },
    { name: 'No7 Airbrush Away Primer', price: 16.50 },
  ],
};

// Generate random purchase/trade-in history for new members
function generateRandomHistory() {
  const transactions = [];
  const now = new Date();

  // 10 items total: 7 purchases (70%), 3 trade-ins (30%)
  // Always include the 3 required products
  const requiredProducts = [...BOOTS_PRODUCTS.required];
  const randomPool = [...BOOTS_PRODUCTS.random];

  // Shuffle random pool
  for (let i = randomPool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [randomPool[i], randomPool[j]] = [randomPool[j], randomPool[i]];
  }

  // Pick 7 additional random products (10 total - 3 required)
  const selectedProducts = [...requiredProducts, ...randomPool.slice(0, 7)];

  // Shuffle all selected products
  for (let i = selectedProducts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [selectedProducts[i], selectedProducts[j]] = [selectedProducts[j], selectedProducts[i]];
  }

  // Assign 7 purchases and 3 trade-ins (70/30 ratio)
  const types = ['Purchase', 'Purchase', 'Purchase', 'Purchase', 'Purchase', 'Purchase', 'Purchase', 'Trade-in', 'Trade-in', 'Trade-in'];

  // Shuffle types
  for (let i = types.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [types[i], types[j]] = [types[j], types[i]];
  }

  // Generate transactions over last 30 days
  for (let i = 0; i < 10; i++) {
    const product = selectedProducts[i];
    const type = types[i];
    const daysAgo = Math.floor(Math.random() * 30) + 1;
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);

    // Calculate points: Purchase = 3pts/£1, Trade-in = 1pt/£1 (rounded up)
    const points = type === 'Purchase'
      ? Math.ceil(product.price * 3)
      : Math.ceil(product.price);

    transactions.push({
      product: product.name,
      type,
      points,
      date: date.toISOString(),
    });
  }

  // Sort by date (newest first)
  transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

  return transactions;
}

// Database abstraction - supports both local SQLite and Turso (serverless)
let db;
let isAsync = false;

if (process.env.TURSO_DATABASE_URL) {
  // Use Turso for serverless (Vercel)
  const { createClient } = require('@libsql/client');
  db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  isAsync = true;
  console.log('Using Turso database');
} else {
  // Use local SQLite for development
  const Database = require('better-sqlite3');
  const path = require('path');
  const fs = require('fs');

  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'pentatonic.db');
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  db = new Database(dbPath);
  console.log('Using local SQLite database');
}

// Initialize tables
const initSQL = `
  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    auth_token TEXT NOT NULL,
    name TEXT DEFAULT NULL,
    profile_token TEXT DEFAULT NULL,
    reward_currency TEXT DEFAULT NULL,
    points INTEGER DEFAULT 0,
    tier TEXT DEFAULT 'GREEN',
    member_since TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_library_id TEXT NOT NULL,
    push_token TEXT NOT NULL,
    member_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(device_library_id, member_id)
  );

  CREATE TABLE IF NOT EXISTS points_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id TEXT NOT NULL,
    points_change INTEGER NOT NULL,
    reason TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS pass_refreshes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id TEXT NOT NULL,
    device_library_id TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS taps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id TEXT,
    kiosk TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`;

// Initialize database
(async () => {
  if (isAsync) {
    const statements = initSQL.split(';').filter(s => s.trim());
    for (const stmt of statements) {
      await db.execute(stmt);
    }
    // Migration: add name column if it doesn't exist
    try {
      await db.execute('ALTER TABLE members ADD COLUMN name TEXT DEFAULT NULL');
    } catch (e) {
      // Column already exists, ignore
    }
    // Migration: add profile_token column if it doesn't exist
    try {
      await db.execute('ALTER TABLE members ADD COLUMN profile_token TEXT DEFAULT NULL');
    } catch (e) {
      // Column already exists, ignore
    }
    // Migration: add reward_currency column if it doesn't exist
    try {
      await db.execute('ALTER TABLE members ADD COLUMN reward_currency TEXT DEFAULT NULL');
    } catch (e) {
      // Column already exists, ignore
    }
    // Backfill profile_token for existing members
    const members = await db.execute({ sql: 'SELECT id FROM members WHERE profile_token IS NULL', args: [] });
    for (const member of members.rows) {
      const token = crypto.randomBytes(16).toString('hex');
      await db.execute({ sql: 'UPDATE members SET profile_token = ? WHERE id = ?', args: [token, member.id] });
    }
  } else {
    db.exec(initSQL);
    // Migration: add name column if it doesn't exist
    try {
      db.exec('ALTER TABLE members ADD COLUMN name TEXT DEFAULT NULL');
    } catch (e) {
      // Column already exists, ignore
    }
    // Migration: add profile_token column if it doesn't exist
    try {
      db.exec('ALTER TABLE members ADD COLUMN profile_token TEXT DEFAULT NULL');
    } catch (e) {
      // Column already exists, ignore
    }
    // Migration: add reward_currency column if it doesn't exist
    try {
      db.exec('ALTER TABLE members ADD COLUMN reward_currency TEXT DEFAULT NULL');
    } catch (e) {
      // Column already exists, ignore
    }
    // Backfill profile_token for existing members
    const members = db.prepare('SELECT id FROM members WHERE profile_token IS NULL').all();
    for (const member of members) {
      const token = crypto.randomBytes(16).toString('hex');
      db.prepare('UPDATE members SET profile_token = ? WHERE id = ?').run(token, member.id);
    }
  }
})();

function calculateTier(points, currentTier = null) {
  // DIAMOND is exclusive - preserve it if already set
  if (currentTier === 'DIAMOND') return 'DIAMOND';
  if (points >= 10000) return 'PLATINUM';
  if (points >= 5000) return 'GOLD';
  if (points >= 1000) return 'SILVER';
  return 'GREEN';
}

// Member functions
async function createMember(id) {
  const authToken = crypto.randomBytes(32).toString('hex');
  const profileToken = crypto.randomBytes(16).toString('hex');
  const memberSince = new Date().toISOString().split('T')[0];

  // Blank account on creation: zero points, base tier, no purchase/trade-in history.
  // (generateRandomHistory is kept above for easy re-enabling of demo seeding.)
  const startingPoints = 0;
  const tier = calculateTier(startingPoints);

  if (isAsync) {
    await db.execute({
      sql: 'INSERT INTO members (id, auth_token, profile_token, member_since, points, tier) VALUES (?, ?, ?, ?, ?, ?)',
      args: [id, authToken, profileToken, memberSince, startingPoints, tier],
    });
  } else {
    db.prepare('INSERT INTO members (id, auth_token, profile_token, member_since, points, tier) VALUES (?, ?, ?, ?, ?, ?)').run(id, authToken, profileToken, memberSince, startingPoints, tier);
  }

  return getMember(id);
}

async function getMember(id) {
  if (isAsync) {
    const result = await db.execute({ sql: 'SELECT * FROM members WHERE id = ?', args: [id] });
    return result.rows[0] || null;
  } else {
    return db.prepare('SELECT * FROM members WHERE id = ?').get(id);
  }
}

async function getMemberByAuthToken(authToken) {
  if (isAsync) {
    const result = await db.execute({ sql: 'SELECT * FROM members WHERE auth_token = ?', args: [authToken] });
    return result.rows[0] || null;
  } else {
    return db.prepare('SELECT * FROM members WHERE auth_token = ?').get(authToken);
  }
}

async function validateProfileToken(memberId, profileToken) {
  if (isAsync) {
    const result = await db.execute({
      sql: 'SELECT * FROM members WHERE id = ? AND profile_token = ?',
      args: [memberId, profileToken],
    });
    return result.rows[0] || null;
  } else {
    return db.prepare('SELECT * FROM members WHERE id = ? AND profile_token = ?').get(memberId, profileToken);
  }
}

// Look up a member by their profile_token (used as the browser "login ticket" cookie)
async function getMemberByProfileToken(profileToken) {
  if (!profileToken) return null;
  if (isAsync) {
    const result = await db.execute({ sql: 'SELECT * FROM members WHERE profile_token = ?', args: [profileToken] });
    return result.rows[0] || null;
  } else {
    return db.prepare('SELECT * FROM members WHERE profile_token = ?').get(profileToken);
  }
}

// Persist the member's reward currency (inferred from the kiosk they onboarded at)
async function setMemberCurrency(id, currency) {
  if (!currency) return;
  if (isAsync) {
    await db.execute({ sql: 'UPDATE members SET reward_currency = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', args: [currency, id] });
  } else {
    db.prepare('UPDATE members SET reward_currency = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(currency, id);
  }
}

// Record a kiosk tap (member may be null for a brand-new visitor)
async function logTap(memberId, kiosk) {
  if (isAsync) {
    await db.execute({ sql: 'INSERT INTO taps (member_id, kiosk) VALUES (?, ?)', args: [memberId || null, kiosk || null] });
  } else {
    db.prepare('INSERT INTO taps (member_id, kiosk) VALUES (?, ?)').run(memberId || null, kiosk || null);
  }
}

async function updateMemberPoints(id, pointsChange, reason = null) {
  const member = await getMember(id);
  if (!member) return null;

  const newPoints = Math.max(0, member.points + pointsChange);
  const newTier = calculateTier(newPoints, member.tier);

  if (isAsync) {
    await db.execute({
      sql: 'UPDATE members SET points = ?, tier = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [newPoints, newTier, id],
    });
    await db.execute({
      sql: 'INSERT INTO points_history (member_id, points_change, reason) VALUES (?, ?, ?)',
      args: [id, pointsChange, reason],
    });
  } else {
    db.prepare('UPDATE members SET points = ?, tier = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newPoints, newTier, id);
    db.prepare('INSERT INTO points_history (member_id, points_change, reason) VALUES (?, ?, ?)').run(id, pointsChange, reason);
  }

  return getMember(id);
}

async function updateMemberProfile(id, { name }) {
  const member = await getMember(id);
  if (!member) return null;

  if (isAsync) {
    await db.execute({
      sql: 'UPDATE members SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [name, id],
    });
  } else {
    db.prepare('UPDATE members SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name, id);
  }

  return getMember(id);
}

// Registration functions
async function registerDevice(deviceLibraryId, pushToken, memberId) {
  if (isAsync) {
    await db.execute({
      sql: 'INSERT OR REPLACE INTO registrations (device_library_id, push_token, member_id) VALUES (?, ?, ?)',
      args: [deviceLibraryId, pushToken, memberId],
    });
  } else {
    db.prepare('INSERT OR REPLACE INTO registrations (device_library_id, push_token, member_id) VALUES (?, ?, ?)').run(deviceLibraryId, pushToken, memberId);
  }
}

async function unregisterDevice(deviceLibraryId, memberId) {
  if (isAsync) {
    await db.execute({
      sql: 'DELETE FROM registrations WHERE device_library_id = ? AND member_id = ?',
      args: [deviceLibraryId, memberId],
    });
  } else {
    db.prepare('DELETE FROM registrations WHERE device_library_id = ? AND member_id = ?').run(deviceLibraryId, memberId);
  }
}

async function getDevicesForMember(memberId) {
  if (isAsync) {
    const result = await db.execute({
      sql: 'SELECT device_library_id, push_token FROM registrations WHERE member_id = ?',
      args: [memberId],
    });
    return result.rows;
  } else {
    return db.prepare('SELECT device_library_id, push_token FROM registrations WHERE member_id = ?').all(memberId);
  }
}

async function getSerialNumbersForDevice(deviceLibraryId) {
  if (isAsync) {
    const result = await db.execute({
      sql: 'SELECT member_id as serialNumber FROM registrations WHERE device_library_id = ?',
      args: [deviceLibraryId],
    });
    return result.rows.map(r => r.serialNumber);
  } else {
    return db.prepare('SELECT member_id as serialNumber FROM registrations WHERE device_library_id = ?').all(deviceLibraryId).map(r => r.serialNumber);
  }
}

async function getPointsHistory(memberId, limit = 10) {
  if (isAsync) {
    const result = await db.execute({
      sql: 'SELECT points_change, reason, created_at FROM points_history WHERE member_id = ? ORDER BY created_at DESC LIMIT ?',
      args: [memberId, limit],
    });
    return result.rows;
  } else {
    return db.prepare('SELECT points_change, reason, created_at FROM points_history WHERE member_id = ? ORDER BY created_at DESC LIMIT ?').all(memberId, limit);
  }
}

async function logPassRefresh(memberId, deviceLibraryId = null, userAgent = null) {
  if (isAsync) {
    await db.execute({
      sql: 'INSERT INTO pass_refreshes (member_id, device_library_id, user_agent) VALUES (?, ?, ?)',
      args: [memberId, deviceLibraryId, userAgent],
    });
  } else {
    db.prepare('INSERT INTO pass_refreshes (member_id, device_library_id, user_agent) VALUES (?, ?, ?)').run(memberId, deviceLibraryId, userAgent);
  }
}

async function getPassRefreshes(memberId, limit = 50) {
  if (isAsync) {
    const result = await db.execute({
      sql: 'SELECT device_library_id, user_agent, created_at FROM pass_refreshes WHERE member_id = ? ORDER BY created_at DESC LIMIT ?',
      args: [memberId, limit],
    });
    return result.rows;
  } else {
    return db.prepare('SELECT device_library_id, user_agent, created_at FROM pass_refreshes WHERE member_id = ? ORDER BY created_at DESC LIMIT ?').all(memberId, limit);
  }
}

async function getAllMembers() {
  if (isAsync) {
    const result = await db.execute({ sql: 'SELECT id, points, tier, member_since FROM members', args: [] });
    return result.rows;
  } else {
    return db.prepare('SELECT id, points, tier, member_since FROM members').all();
  }
}

async function getRefreshStats(memberId) {
  if (isAsync) {
    const total = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM pass_refreshes WHERE member_id = ?',
      args: [memberId],
    });
    const last24h = await db.execute({
      sql: "SELECT COUNT(*) as count FROM pass_refreshes WHERE member_id = ? AND created_at > datetime('now', '-24 hours')",
      args: [memberId],
    });
    const lastRefresh = await db.execute({
      sql: 'SELECT created_at FROM pass_refreshes WHERE member_id = ? ORDER BY created_at DESC LIMIT 1',
      args: [memberId],
    });
    return {
      total: total.rows[0]?.count || 0,
      last24h: last24h.rows[0]?.count || 0,
      lastRefresh: lastRefresh.rows[0]?.created_at || null,
    };
  } else {
    const total = db.prepare('SELECT COUNT(*) as count FROM pass_refreshes WHERE member_id = ?').get(memberId);
    const last24h = db.prepare("SELECT COUNT(*) as count FROM pass_refreshes WHERE member_id = ? AND created_at > datetime('now', '-24 hours')").get(memberId);
    const lastRefresh = db.prepare('SELECT created_at FROM pass_refreshes WHERE member_id = ? ORDER BY created_at DESC LIMIT 1').get(memberId);
    return {
      total: total?.count || 0,
      last24h: last24h?.count || 0,
      lastRefresh: lastRefresh?.created_at || null,
    };
  }
}

module.exports = {
  createMember,
  getMember,
  getMemberByAuthToken,
  validateProfileToken,
  getMemberByProfileToken,
  setMemberCurrency,
  logTap,
  updateMemberPoints,
  updateMemberProfile,
  registerDevice,
  unregisterDevice,
  getDevicesForMember,
  getSerialNumbersForDevice,
  getPointsHistory,
  logPassRefresh,
  getPassRefreshes,
  getRefreshStats,
  getAllMembers,
};
