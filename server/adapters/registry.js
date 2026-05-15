'use strict';

/*
 * Adapter registry — the single place the rest of the server reaches for
 * hauler-specific integration logic. Dispatches by integration type,
 * returns normalised AXIS-schema payloads regardless of the upstream.
 */

const loconav = require('./loconav');
const geotab  = require('./geotab');
const manual  = require('./manual');

const ADAPTERS = {
  loconav,
  geotab,
  manual,
};

function adapterFor(hauler) {
  const type    = hauler?.integration?.type;
  const adapter = hauler?.integration?.adapter;
  if (type === 'loconav') return ADAPTERS.loconav;
  if (type === 'manual')  return ADAPTERS.manual;
  if (type === 'custom' && adapter === 'geotab') return ADAPTERS.geotab;
  return null;
}

async function probe(hauler, creds) {
  const a = adapterFor(hauler);
  if (!a) throw new Error(`No adapter registered for hauler ${hauler.id}`);
  return a.probe(creds);
}

async function syncFleet(hauler, creds) {
  const a = adapterFor(hauler);
  if (!a) throw new Error(`No adapter registered for hauler ${hauler.id}`);
  return a.syncFleet(creds, hauler);
}

module.exports = { ADAPTERS, adapterFor, probe, syncFleet };
