const { PKPass } = require('passkit-generator');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const db = require('./db');

// Tier colors - dynamic theming based on membership level
// All tiers use black background except Diamond (exclusive)
const TIER_COLORS = {
  // Mastercard-forward theme: black card, white text, Mastercard-orange labels.
  // Accent held constant across tiers so the card reads as Mastercard, not tier-coloured.
  GREEN: {
    backgroundColor: 'rgb(23, 23, 23)',      // #171717 - black card
    foregroundColor: 'rgb(255, 255, 255)',   // #FFFFFF - White
    labelColor: 'rgb(255, 95, 0)',           // #FF5F00 - Mastercard orange
  },
  SILVER: {
    backgroundColor: 'rgb(23, 23, 23)',      // #171717 - black card
    foregroundColor: 'rgb(255, 255, 255)',   // White
    labelColor: 'rgb(255, 95, 0)',           // #FF5F00 - Mastercard orange
  },
  GOLD: {
    backgroundColor: 'rgb(23, 23, 23)',      // #171717 - black card
    foregroundColor: 'rgb(255, 255, 255)',   // White
    labelColor: 'rgb(255, 95, 0)',           // #FF5F00 - Mastercard orange
  },
  PLATINUM: {
    backgroundColor: 'rgb(23, 23, 23)',      // #171717 - black card
    foregroundColor: 'rgb(255, 255, 255)',   // White
    labelColor: 'rgb(255, 95, 0)',           // #FF5F00 - Mastercard orange
  },
  DIAMOND: {
    backgroundColor: 'rgb(224, 33, 138)',    // #E0218A - Barbie pink
    foregroundColor: 'rgb(255, 255, 255)',   // White
    labelColor: 'rgb(255, 255, 255)',        // White labels on pink
  },
};

// Store locations for lock screen relevance
const STORE_LOCATIONS = [
  {
    latitude: 50.808131,   // 13 Heene Terrace, BN11 3NR, Worthing
    longitude: -0.384057,
    relevantText: 'Welcome to Pentatonic Worthing!',
    radius: 500,           // 500 meters - increased for better detection
  },
  {
    latitude: 51.538892,   // 27 Downham Road, N1 5AA, London
    longitude: -0.077822,
    relevantText: 'Welcome to Pentatonic London!',
    radius: 500,           // 500 meters
  },
];

// Get certificates - from env vars (base64) or files
function getCertificates() {
  // Check for base64 encoded certs in env vars (for Vercel)
  if (process.env.SIGNER_CERT_BASE64) {
    return {
      signerCert: Buffer.from(process.env.SIGNER_CERT_BASE64, 'base64'),
      signerKey: Buffer.from(process.env.SIGNER_KEY_BASE64, 'base64'),
      wwdr: Buffer.from(process.env.WWDR_CERT_BASE64, 'base64'),
    };
  }

  // Fall back to files (local development)
  return {
    signerCert: fs.readFileSync(config.certificates.signerCert),
    signerKey: fs.readFileSync(config.certificates.signerKey),
    wwdr: fs.readFileSync(config.certificates.wwdr),
  };
}

/**
 * Generates a unique Pentatonic membership pass
 * @param {string} baseUrl - The base URL for the web service
 * @param {string} existingMemberId - Optional existing member ID to regenerate pass
 * @returns {Promise<{buffer: Buffer, memberId: string, member: object}>}
 */
// Money-reward config (PLACEHOLDERS — replace map + rate with the real kiosk list & reward rule)
const REWARD_POINTS_PER_UNIT = 100; // 100 points = 1 unit of the local currency
// The 10 MEC kiosk cities -> local currency. Accepts "New York", "new-york", "newyork" etc.
const KIOSK_CURRENCY = {
  singapore: 'SGD',
  sydney: 'AUD',
  dubai: 'AED',
  brussels: 'EUR',
  stockholm: 'SEK',
  dublin: 'EUR',
  london: 'GBP',
  vancouver: 'CAD',
  newyork: 'USD',
  mexicocity: 'MXN',
};
function currencyForKiosk(kiosk) {
  if (!kiosk) return null;
  const key = String(kiosk).toLowerCase().replace(/[\s_-]+/g, ''); // normalise spacing/case
  return KIOSK_CURRENCY[key] || null; // null = unknown, let caller fall back
}

async function generatePass(baseUrl, existingMemberId = null, opts = {}) {
  let member;

  if (existingMemberId) {
    member = await db.getMember(existingMemberId);
    if (!member) {
      throw new Error('Member not found');
    }
  } else {
    const memberId = uuidv4();
    member = await db.createMember(memberId);
  }

  const memberSince = new Date(member.member_since).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
  });

  // Ensure auth token is at least 16 chars (Apple requirement)
  const authToken = member.auth_token && member.auth_token.length >= 16
    ? member.auth_token
    : crypto.randomBytes(16).toString('hex');

  // Get recent points history for back field (last 10 transactions)
  const history = await db.getPointsHistory(member.id, 10);
  const recentActivity = history.length > 0
    ? history.map(h => {
        const date = new Date(h.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const sign = h.points_change >= 0 ? '+' : '';
        return `${sign}${h.points_change} ${h.reason || 'Points update'} (${date})`;
      }).join('\n')
    : 'No recent activity';

  // Get certificates
  const { signerCert, signerKey, wwdr } = getCertificates();

  // Get tier-based colors
  const tierColors = TIER_COLORS[member.tier] || TIER_COLORS.GREEN;

  // Create pass from template with tier colors in overrides
  const pass = await PKPass.from(
    {
      model: config.templatePath,
      certificates: {
        signerCert,
        signerKey,
        wwdr,
        signerKeyPassphrase: config.signerKeyPassphrase || undefined,
      },
    },
    {
      serialNumber: member.id,
      passTypeIdentifier: config.passTypeId,
      teamIdentifier: config.teamId,
      webServiceURL: baseUrl,
      authenticationToken: authToken,
      backgroundColor: tierColors.backgroundColor,
      foregroundColor: tierColors.foregroundColor,
      labelColor: tierColors.labelColor,
    }
  );

  // Update field values directly by index (FieldsArray requires direct modification)
  // Diamond tier shows infinity symbol instead of points
  pass.headerFields[0].value = member.tier === 'DIAMOND' ? '∞' : member.points;
  pass.headerFields[0].changeMessage = member.tier === 'DIAMOND' ? 'Welcome, Diamond member!' : 'You now have %@ points!';
  // Money reward — currency inferred from the kiosk location, persisted per member so it
  // stays correct on later auto-updates (which carry no kiosk context).
  const kioskCurrency = opts.currency || currencyForKiosk(opts.kiosk);
  const rewardCurrency = kioskCurrency || member.reward_currency || 'USD';
  if (kioskCurrency && kioskCurrency !== member.reward_currency) {
    await db.setMemberCurrency(member.id, kioskCurrency);
  }
  const rewardValue = Math.round((member.points / REWARD_POINTS_PER_UNIT) * 100) / 100;
  pass.headerFields[1].value = rewardValue;
  pass.headerFields[1].currencyCode = rewardCurrency;
  pass.headerFields[1].changeMessage = 'Your reward is now %@';
  pass.primaryFields[0].value = member.id.toUpperCase().slice(0, 8);
  // Set name in auxiliaryFields (visible below primary field)
  if (member.name) {
    pass.auxiliaryFields[0].label = 'NAME';
    pass.auxiliaryFields[0].value = member.name;
    pass.auxiliaryFields[0].changeMessage = 'Your name has been updated to %@';
  } else {
    pass.auxiliaryFields[0].label = '';
    pass.auxiliaryFields[0].value = '';
  }
  pass.secondaryFields[0].value = member.tier;
  pass.secondaryFields[0].changeMessage = 'Your tier is now %@!';
  pass.secondaryFields[1].value = memberSince;

  // Back fields: memberId, editProfile, passDetails, recentActivity, website, terms
  pass.backFields[0].value = member.id;
  const profileToken = member.profile_token || '';
  const profileUrl = `${baseUrl}/profile/${member.id}?token=${profileToken}`;
  pass.backFields[1].value = profileUrl;
  pass.backFields[1].attributedValue = `<a href='${profileUrl}'>Update your name or view full history</a>`;
  const downloadUrl = `${baseUrl}/pass/${member.id}`;
  pass.backFields[2].value = downloadUrl;
  pass.backFields[2].attributedValue = `<a href='${downloadUrl}'>Tap to re-download this pass</a>`;
  pass.backFields[3].value = recentActivity;
  pass.backFields[4].value = 'https://pentatonic.com';
  pass.backFields[5].value = 'This membership card is personal and non-transferable. Points are earned through sustainable actions and purchases. For support, visit pentatonic.com/support';

  // Set barcode with full member ID
  pass.setBarcodes({
    format: 'PKBarcodeFormatQR',
    message: member.id,
    messageEncoding: 'iso-8859-1',
  });

  // Add store locations for lock screen relevance
  pass.setLocations(...STORE_LOCATIONS);

  // Generate the pass buffer
  const buffer = pass.getAsBuffer();

  return {
    buffer,
    memberId: member.id,
    member,
  };
}

module.exports = { generatePass, currencyForKiosk, REWARD_POINTS_PER_UNIT };
