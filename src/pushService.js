const apn = require('apn');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const config = require('./config');

let apnProvider = null;

const apnsKeyPath = path.join(__dirname, '..', 'certificates', 'apns', 'AuthKey.p8');
const apnsKeyId = process.env.APNS_KEY_ID;
const apnsTeamId = process.env.APNS_TEAM_ID || config.teamId;

// Get APNs key - from base64 env var or file
function getApnsKey() {
  if (process.env.APNS_KEY_BASE64) {
    return Buffer.from(process.env.APNS_KEY_BASE64, 'base64');
  }
  if (fs.existsSync(apnsKeyPath)) {
    return fs.readFileSync(apnsKeyPath);
  }
  return null;
}

// Initialize APNs provider
function initializeProvider() {
  if (apnProvider) return apnProvider;

  const apnsKey = getApnsKey();
  if (!apnsKey) {
    console.log('APNs key not found. Push notifications disabled.');
    return null;
  }

  if (!apnsKeyId) {
    console.log('APNS_KEY_ID not set. Push notifications disabled.');
    return null;
  }

  try {
    apnProvider = new apn.Provider({
      token: {
        key: apnsKey,
        keyId: apnsKeyId,
        teamId: apnsTeamId,
      },
      production: true, // Always use production for Wallet passes
    });

    console.log('APNs provider initialized successfully');
    return apnProvider;
  } catch (error) {
    console.error('Failed to initialize APNs provider:', error);
    return null;
  }
}

/**
 * Send push notification to update passes for a member
 * @param {string} memberId - The member ID to notify
 */
async function notifyPassUpdate(memberId) {
  const provider = initializeProvider();

  if (!provider) {
    console.log(`[Push] Skipping notification for ${memberId} - APNs not configured`);
    return { sent: 0, skipped: true };
  }

  const devices = await db.getDevicesForMember(memberId);

  if (devices.length === 0) {
    console.log(`[Push] No registered devices for member ${memberId}`);
    return { sent: 0 };
  }

  // Apple Wallet passes use empty push notifications
  // The pass will automatically request an update when it receives one
  const notification = new apn.Notification();
  notification.topic = config.passTypeId;
  notification.payload = {}; // Empty payload for pass updates

  const results = await Promise.all(
    devices.map(async (device) => {
      try {
        const result = await provider.send(notification, device.push_token);
        if (result.failed.length > 0) {
          console.log(`[Push] Failed to send to ${device.push_token}:`, result.failed[0].response);
          return { success: false, device: device.device_library_id };
        }
        console.log(`[Push] Sent notification to device ${device.device_library_id}`);
        return { success: true, device: device.device_library_id };
      } catch (error) {
        console.error(`[Push] Error sending to ${device.push_token}:`, error);
        return { success: false, device: device.device_library_id, error: error.message };
      }
    })
  );

  const sent = results.filter(r => r.success).length;
  console.log(`[Push] Sent ${sent}/${devices.length} notifications for member ${memberId}`);

  return { sent, total: devices.length, results };
}

// Cleanup on exit
process.on('exit', () => {
  if (apnProvider) {
    apnProvider.shutdown();
  }
});

module.exports = {
  notifyPassUpdate,
  initializeProvider,
};
