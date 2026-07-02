#!/usr/bin/env node
// Simple database query tool - auto-loads .env.local

const fs = require('fs');
const path = require('path');

// Load .env.local
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && !key.startsWith('#') && valueParts.length) {
      process.env[key.trim()] = valueParts.join('=').trim();
    }
  });
}

if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  console.log('\nMissing credentials. Add TURSO_AUTH_TOKEN to .env.local');
  console.log('Get token from: https://turso.tech/app > pentatonic-wallet > Generate Token\n');
  process.exit(1);
}

const { createClient } = require('@libsql/client');
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const commands = {
  async members() {
    const result = await db.execute('SELECT id, name, points, tier, member_since FROM members ORDER BY points DESC');
    console.log('\n┌──────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ MEMBERS                                                                      │');
    console.log('├──────────────┬──────────────────┬────────┬──────────┬───────────────────────┤');
    console.log('│ ID           │ Name             │ Points │ Tier     │ Since                 │');
    console.log('├──────────────┼──────────────────┼────────┼──────────┼───────────────────────┤');
    result.rows.forEach(m => {
      const name = (m.name || '').slice(0, 14).padEnd(16);
      console.log(`│ ${m.id.slice(0, 8)}...  │ ${name} │ ${String(m.points).padStart(6)} │ ${m.tier.padEnd(8)} │ ${m.member_since}            │`);
    });
    console.log('└──────────────┴──────────────────┴────────┴──────────┴───────────────────────┘');
    console.log(`Total: ${result.rows.length} members\n`);
  },

  async refreshes() {
    const result = await db.execute(`
      SELECT member_id, COUNT(*) as count, MAX(created_at) as last_refresh
      FROM pass_refreshes GROUP BY member_id ORDER BY count DESC
    `);
    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│ REFRESH STATS                                               │');
    console.log('├──────────────┬───────────┬─────────────────────────────────┤');
    console.log('│ Member       │ Refreshes │ Last Refresh                    │');
    console.log('├──────────────┼───────────┼─────────────────────────────────┤');
    if (result.rows.length === 0) {
      console.log('│ No refresh data yet                                         │');
    } else {
      result.rows.forEach(r => {
        console.log(`│ ${r.member_id.slice(0, 8)}...  │ ${String(r.count).padStart(9)} │ ${(r.last_refresh || '').slice(0, 19).padEnd(19)}            │`);
      });
    }
    console.log('└──────────────┴───────────┴─────────────────────────────────┘\n');
  },

  async recent() {
    const result = await db.execute(`
      SELECT member_id, user_agent, created_at FROM pass_refreshes
      ORDER BY created_at DESC LIMIT 15
    `);
    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│ RECENT REFRESHES                                            │');
    console.log('├─────────────────────┬──────────────┬────────────────────────┤');
    console.log('│ Time                │ Member       │ Device                 │');
    console.log('├─────────────────────┼──────────────┼────────────────────────┤');
    if (result.rows.length === 0) {
      console.log('│ No refresh data yet                                         │');
    } else {
      result.rows.forEach(r => {
        const device = (r.user_agent || '').includes('iPhone') ? 'iPhone' :
                       (r.user_agent || '').includes('Watch') ? 'Watch' : 'Unknown';
        console.log(`│ ${(r.created_at || '').slice(0, 19)} │ ${r.member_id.slice(0, 8)}...  │ ${device.padEnd(22)} │`);
      });
    }
    console.log('└─────────────────────┴──────────────┴────────────────────────┘\n');
  },

  async patterns() {
    // Get all members
    const members = await db.execute('SELECT id, points, tier FROM members');

    // Get refresh data with time gaps
    const refreshData = await db.execute(`
      SELECT
        member_id,
        COUNT(*) as total_refreshes,
        MAX(created_at) as last_refresh,
        MIN(created_at) as first_refresh
      FROM pass_refreshes
      GROUP BY member_id
    `);

    // Get burst detection (3+ refreshes within 5 minutes = manual checking)
    const bursts = await db.execute(`
      SELECT member_id, MAX(cluster_size) as max_burst
      FROM (
        SELECT
          r1.member_id,
          r1.created_at,
          (SELECT COUNT(*) FROM pass_refreshes r2
           WHERE r2.member_id = r1.member_id
           AND r2.created_at >= r1.created_at
           AND r2.created_at <= datetime(r1.created_at, '+5 minutes')) as cluster_size
        FROM pass_refreshes r1
      )
      GROUP BY member_id
    `);

    // Get recent activity (last 7 days)
    const recentActivity = await db.execute(`
      SELECT member_id, COUNT(*) as recent_count
      FROM pass_refreshes
      WHERE created_at > datetime('now', '-7 days')
      GROUP BY member_id
    `);

    // Build member analysis
    const refreshMap = new Map(refreshData.rows.map(r => [r.member_id, r]));
    const burstMap = new Map(bursts.rows.map(b => [b.member_id, b.max_burst]));
    const recentMap = new Map(recentActivity.rows.map(r => [r.member_id, r.recent_count]));

    const analysis = members.rows.map(m => {
      const refresh = refreshMap.get(m.id) || { total_refreshes: 0, last_refresh: null };
      const maxBurst = burstMap.get(m.id) || 0;
      const recentCount = recentMap.get(m.id) || 0;

      // Determine engagement level
      let engagement = 'NEW';
      let signal = '';

      if (refresh.total_refreshes === 0) {
        engagement = 'NEW';
        signal = 'No pass activity yet';
      } else if (maxBurst >= 3) {
        engagement = 'ACTIVE';
        signal = `${maxBurst} rapid refreshes detected`;
      } else if (recentCount >= 5) {
        engagement = 'ENGAGED';
        signal = `${recentCount} refreshes this week`;
      } else if (recentCount > 0) {
        engagement = 'PASSIVE';
        signal = 'Background refreshes only';
      } else {
        engagement = 'DORMANT';
        signal = `Last seen: ${refresh.last_refresh?.slice(0, 10) || 'never'}`;
      }

      return {
        id: m.id.slice(0, 8),
        tier: m.tier,
        points: m.points,
        engagement,
        signal,
        totalRefreshes: refresh.total_refreshes,
      };
    });

    // Sort by engagement priority
    const engagementOrder = { ACTIVE: 0, ENGAGED: 1, PASSIVE: 2, DORMANT: 3, NEW: 4 };
    analysis.sort((a, b) => engagementOrder[a.engagement] - engagementOrder[b.engagement]);

    // Count by engagement level
    const counts = analysis.reduce((acc, m) => {
      acc[m.engagement] = (acc[m.engagement] || 0) + 1;
      return acc;
    }, {});

    console.log('\n┌───────────────────────────────────────────────────────────────────────────┐');
    console.log('│ ENGAGEMENT PATTERNS                                                       │');
    console.log('├──────────────┬──────────┬─────────┬───────────┬──────────────────────────┤');
    console.log('│ Member       │ Tier     │ Points  │ Status    │ Signal                   │');
    console.log('├──────────────┼──────────┼─────────┼───────────┼──────────────────────────┤');

    analysis.forEach(m => {
      const statusColor = {
        ACTIVE: '\x1b[32m',   // Green
        ENGAGED: '\x1b[36m',  // Cyan
        PASSIVE: '\x1b[33m',  // Yellow
        DORMANT: '\x1b[31m',  // Red
        NEW: '\x1b[90m',      // Gray
      }[m.engagement] || '';
      const reset = '\x1b[0m';

      console.log(`│ ${m.id}...  │ ${m.tier.padEnd(8)} │ ${String(m.points).padStart(7)} │ ${statusColor}${m.engagement.padEnd(9)}${reset} │ ${m.signal.slice(0, 24).padEnd(24)} │`);
    });

    console.log('└──────────────┴──────────┴─────────┴───────────┴──────────────────────────┘');
    console.log(`\nSummary: ${counts.ACTIVE || 0} active, ${counts.ENGAGED || 0} engaged, ${counts.PASSIVE || 0} passive, ${counts.DORMANT || 0} dormant, ${counts.NEW || 0} new\n`);

    // Engagement insights
    console.log('Legend:');
    console.log('  ACTIVE  - Multiple manual check sessions (high engagement)');
    console.log('  ENGAGED - Regular refreshes this week');
    console.log('  PASSIVE - Only background/push refreshes');
    console.log('  DORMANT - No activity in 7+ days');
    console.log('  NEW     - No refresh data yet\n');
  },

  async sql() {
    const query = process.argv.slice(3).join(' ');
    if (!query) {
      console.log('Usage: node scripts/query-db.js sql "SELECT * FROM members"');
      return;
    }
    const result = await db.execute(query);
    console.log(JSON.stringify(result.rows, null, 2));
  },

  help() {
    console.log(`
Pentatonic Wallet - Database Query Tool

Usage: node scripts/query-db.js <command>

Commands:
  members    - List all members with points and tier
  refreshes  - Show refresh statistics per member
  recent     - Show last 15 refresh events
  patterns   - Analyze engagement patterns (active/passive/dormant)
  sql "..."  - Run custom SQL query

Examples:
  node scripts/query-db.js members
  node scripts/query-db.js patterns
  node scripts/query-db.js sql "SELECT COUNT(*) FROM pass_refreshes"
`);
  }
};

async function main() {
  const cmd = process.argv[2] || 'help';
  if (commands[cmd]) {
    await commands[cmd]();
  } else {
    console.log(`Unknown command: ${cmd}`);
    commands.help();
  }
  process.exit(0);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
