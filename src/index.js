const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const config = require('./config');
const { generatePass } = require('./passGenerator');
const { renderLandingPage } = require('./pages');
const db = require('./db');
const pushService = require('./pushService');

const app = express();
app.use(express.json());

// Get the base URL for web service
function getBaseUrl(req) {
  const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const host = req.headers.host;
  return `${protocol}://${host}`;
}

// Auth middleware for Apple Wallet endpoints
function authenticatePass(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('ApplePass ')) {
    return res.status(401).send('Unauthorized');
  }

  const token = authHeader.replace('ApplePass ', '');
  const member = db.getMemberByAuthToken(token);

  if (!member) {
    return res.status(401).send('Unauthorized');
  }

  req.member = member;
  next();
}

// ============================================
// PUBLIC ENDPOINTS
// ============================================

// Landing page with QR code
app.get('/', async (req, res) => {
  const baseUrl = getBaseUrl(req);
  const passUrl = `${baseUrl}/pass`;

  try {
    const qrDataUrl = await QRCode.toDataURL(passUrl, {
      width: 480,
      margin: 2,
      color: { dark: '#141413', light: '#ffffff' }
    });

    res.send(renderLandingPage({ qrDataUrl }));
  } catch (error) {
    res.status(500).send('Error generating QR code');
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'pentatonic-wallet',
    timestamp: new Date().toISOString(),
  });
});

// Generate new pass
app.get('/pass', async (req, res) => {
  try {
    const baseUrl = getBaseUrl(req);
    const { buffer, memberId, member } = await generatePass(baseUrl);

    res.set({
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': 'attachment; filename="pentatonic-member.pkpass"',
      'Content-Length': buffer.length,
    });

    res.send(buffer);
    console.log(`[${new Date().toISOString()}] Generated pass for member: ${memberId} (${member.points} points)`);
  } catch (error) {
    console.error('Error generating pass:', error);
    res.status(500).json({ error: 'Failed to generate pass', message: error.message });
  }
});

// ============================================
// APPLE WALLET WEB SERVICE ENDPOINTS
// https://developer.apple.com/documentation/walletpasses/adding_a_web_service_to_update_passes
// ============================================

// Register device for pass updates
app.post('/v1/devices/:deviceLibraryId/registrations/:passTypeId/:serialNumber', authenticatePass, (req, res) => {
  const { deviceLibraryId, serialNumber } = req.params;
  const { pushToken } = req.body;

  if (!pushToken) {
    return res.status(400).send('Missing push token');
  }

  try {
    db.registerDevice(deviceLibraryId, pushToken, serialNumber);
    console.log(`[${new Date().toISOString()}] Device registered: ${deviceLibraryId} for member ${serialNumber}`);
    res.status(201).send();
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).send('Registration failed');
  }
});

// Unregister device
app.delete('/v1/devices/:deviceLibraryId/registrations/:passTypeId/:serialNumber', authenticatePass, (req, res) => {
  const { deviceLibraryId, serialNumber } = req.params;

  try {
    db.unregisterDevice(deviceLibraryId, serialNumber);
    console.log(`[${new Date().toISOString()}] Device unregistered: ${deviceLibraryId} for member ${serialNumber}`);
    res.status(200).send();
  } catch (error) {
    console.error('Unregistration error:', error);
    res.status(500).send('Unregistration failed');
  }
});

// Get serial numbers for device (for checking updates)
app.get('/v1/devices/:deviceLibraryId/registrations/:passTypeId', (req, res) => {
  const { deviceLibraryId } = req.params;
  const passesUpdatedSince = req.query.passesUpdatedSince;

  try {
    const serialNumbers = db.getSerialNumbersForDevice(deviceLibraryId);

    if (serialNumbers.length === 0) {
      return res.status(204).send();
    }

    res.json({
      serialNumbers,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error getting serial numbers:', error);
    res.status(500).send('Error');
  }
});

// Get latest pass (for updates)
app.get('/v1/passes/:passTypeId/:serialNumber', authenticatePass, async (req, res) => {
  const { serialNumber } = req.params;

  try {
    const baseUrl = getBaseUrl(req);
    const { buffer } = await generatePass(baseUrl, serialNumber);

    res.set({
      'Content-Type': 'application/vnd.apple.pkpass',
      'Last-Modified': new Date().toUTCString(),
    });

    res.send(buffer);
    console.log(`[${new Date().toISOString()}] Pass update sent for member: ${serialNumber}`);
  } catch (error) {
    console.error('Error generating updated pass:', error);
    res.status(500).send('Error');
  }
});

// Log endpoint (for debugging Apple Wallet issues)
app.post('/v1/log', (req, res) => {
  console.log('[Apple Wallet Log]:', JSON.stringify(req.body));
  res.status(200).send();
});

// ============================================
// ADMIN API ENDPOINTS
// ============================================

// Get member info
app.get('/api/members/:memberId', (req, res) => {
  const member = db.getMember(req.params.memberId);
  if (!member) {
    return res.status(404).json({ error: 'Member not found' });
  }

  const history = db.getPointsHistory(member.id);
  res.json({
    id: member.id,
    points: member.points,
    tier: member.tier,
    memberSince: member.member_since,
    history,
  });
});

// Update member points
app.post('/api/members/:memberId/points', async (req, res) => {
  const { memberId } = req.params;
  const { points, reason } = req.body;

  if (typeof points !== 'number') {
    return res.status(400).json({ error: 'Points must be a number' });
  }

  const member = db.updateMemberPoints(memberId, points, reason);
  if (!member) {
    return res.status(404).json({ error: 'Member not found' });
  }

  console.log(`[${new Date().toISOString()}] Points updated for ${memberId}: ${points > 0 ? '+' : ''}${points} (${reason || 'no reason'})`);

  // Send push notification to update the pass
  try {
    await pushService.notifyPassUpdate(memberId);
  } catch (error) {
    console.error('Failed to send push notification:', error.message);
  }

  res.json({
    success: true,
    member: {
      id: member.id,
      points: member.points,
      tier: member.tier,
    },
  });
});

// ============================================
// 404 HANDLER
// ============================================

app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    availableEndpoints: ['/', '/pass', '/health', '/api/members/:id', '/api/members/:id/points'],
  });
});

// ============================================
// START SERVER
// ============================================

const sslCertPath = path.join(__dirname, '..', 'certificates', 'ssl');
const sslKeyFile = path.join(sslCertPath, 'server.key');
const sslCertFile = path.join(sslCertPath, 'server.crt');

if (fs.existsSync(sslKeyFile) && fs.existsSync(sslCertFile)) {
  const httpsOptions = {
    key: fs.readFileSync(sslKeyFile),
    cert: fs.readFileSync(sslCertFile),
  };

  https.createServer(httpsOptions, app).listen(config.port, () => {
    console.log(`Pentatonic Wallet Service running on HTTPS port ${config.port}`);
    console.log(`  - Landing page: https://localhost:${config.port}/`);
    console.log(`  - Generate pass: https://localhost:${config.port}/pass`);
    console.log(`  - API: https://localhost:${config.port}/api/members/:id`);
  });
} else {
  app.listen(config.port, () => {
    console.log(`Pentatonic Wallet Service running on port ${config.port}`);
    console.log(`  - Landing page: http://localhost:${config.port}/`);
    console.log(`  - Generate pass: http://localhost:${config.port}/pass`);
    console.log(`  - API: http://localhost:${config.port}/api/members/:id`);
  });
}
