require('dotenv').config();
const { makeOutboundCall } = require('../services/vapi');

async function run() {
  const res = await makeOutboundCall({
    name: 'Test Lead',
    phone: '+18002255288',
    property_interest: 'Villa'
  });
  console.log('VAPI RESPONSE:', res);
}
run();
