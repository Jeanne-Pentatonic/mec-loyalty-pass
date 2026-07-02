const path = require('path');

module.exports = {
  // Pass configuration
  passTypeId: process.env.PASS_TYPE_ID || 'pass.com.pentatonic.loyalty',
  teamId: process.env.TEAM_ID || 'SJPM5MT6LL',

  // Server configuration
  port: parseInt(process.env.PORT, 10) || 3000,

  // Certificate paths
  certificates: {
    signerCert: path.join(__dirname, '..', 'certificates', 'signerCert.pem'),
    signerKey: path.join(__dirname, '..', 'certificates', 'signerKey.pem'),
    wwdr: path.join(__dirname, '..', 'certificates', 'wwdr.pem'),
  },

  // Pass template path (must end with .pass for passkit-generator)
  templatePath: path.join(__dirname, '..', 'pass-template.pass'),

  // Optional: passphrase for the private key
  signerKeyPassphrase: process.env.SIGNER_KEY_PASSPHRASE || '',
};
