'use strict';

/*
 * AXIS Intelligence service.
 * Wraps the Anthropic SDK for two surfaces:
 *   1. observe(page, context) — proactive observation cards for a given page
 *   2. chat(question, context) — interactive Q&A from the Today page input
 *
 * Caching: per-page observation results cache for 60s to absorb dashboard
 * polling. Chat is not cached (each question is unique).
 *
 * Voice register (BRIEF.md §12.3):
 *   - Specific, terse, named entities, named costs, one action.
 *   - No hedging language. No banned terms (solutions, leverage, etc.).
 *   - 25 words or fewer per observation. 60 words or fewer per chat reply.
 *
 * Fallback: when ANTHROPIC_API_KEY is not present the service returns
 * hand-authored stand-ins so the demo remains usable in mock mode.
 */

const NodeCache = require('node-cache');
const observationSynth = require('./observationSynth');

let Anthropic;
try {
  Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
} catch (_err) {
  Anthropic = null;
}

const OBS_MODEL  = 'claude-opus-4-7';
const CHAT_MODEL = 'claude-sonnet-4-6';

const cache = new NodeCache({ stdTTL: 60, checkperiod: 30 });

const BANNED = /\b(solutions?|innovative|cutting-edge|best-in-class|world-class|journey|leverage|unlock|synergy|ecosystem|excited|delighted|empower|revolutionis[ez]e?)\b/i;

const SYSTEM_PROMPT = `You are AXIS Intelligence — the analyst layer of the AXIS Command Center, a multi-hauler corridor aggregation platform for the Nyinahin–Takoradi (300 km) bauxite haulage project in Ghana under contract to GIBDLC.

Voice register — non-negotiable:
- Port-authority notice tone. Specific, terse, named entities, named costs, one action.
- 25 words or fewer per observation. 60 words or fewer per chat reply.
- Numbers carry units: 40 tonnes, 300 km, GHS 16.10, $24, 28.4%. Never "24 dollars" or "28 per cent".
- Dates long form: 14 January 2026.
- Banned terms: solutions, innovative, cutting-edge, best-in-class, world-class, journey, leverage, unlock, synergy, ecosystem, excited, delighted, empower, revolutionise.
- No hedging. No "we", "our", "I", "you". No "Powered by Claude", no greetings.
- No bullet lists in chat replies — single dense paragraph.

Reference observation shape (Hauler 02 style):
"The Nyinahin weighbridge held 4 Hauler 02 trucks over the 40-tonne limit between 07:00 and 09:00. Forced off-load delayed the Takoradi cut-off by 42 minutes. Recommend coaching the Hauler 02 dispatcher on pre-departure verification."`;

const FALLBACK_OBSERVATIONS = {
  today: [
    { id: 'fbk-t1', severity: 'warn', body: 'Hauler 02 absorbed 4 weighbridge holds in 30 days against a corridor total of 5. 196 minutes of forced off-load and $2,840 in opportunity cost.' },
    { id: 'fbk-t2', severity: 'warn', body: 'Run-rate is 79.3% of contracted MTD. Take-or-pay floor sits at 80% — a 373-tonne shortfall with 10 days of April remaining.' },
    { id: 'fbk-t3', severity: 'info', body: 'Effective tariff is $24.36 per tonne, +1.51% above the $24.00 base after April reindexation. Fuel component contributed +2.42%, CPI +1.80%.' },
    { id: 'fbk-t4', severity: 'info', body: 'DSCR closed March at 1.31× and is tracking 1.34× in April — 3.1% headroom on the 1.30× covenant. Steady-state target remains 2.5×.' },
  ],
  contract: [
    { id: 'fbk-c1', severity: 'warn', body: 'Delivered MTD is 373 tonnes below the 80% take-or-pay floor. GIBDLC will bill the floor unless April closes ≥ 44,362 tonnes — 4.5 days of full output remaining.' },
    { id: 'fbk-c2', severity: 'info', body: 'Receivables 3.2% in the 61–90 band against the 5% covenant ceiling — the first breach-adjacent reading since contract signing. Clears 15 May if the 18 April invoice settles on terms.' },
  ],
  tariff: [
    { id: 'fbk-tr1', severity: 'info', body: 'NPA diesel is GHS 16.10 against a base of GHS 15.72 — +2.42%. Next reindexation 01 May 2026; 11 days out.' },
    { id: 'fbk-tr2', severity: 'info', body: 'GSS CPI at 101.8 against a base of 100.0 — +1.80%. Combined with diesel and the fixed component, effective tariff is $24.36 per tonne.' },
  ],
  tranches: [
    { id: 'fbk-tn1', severity: 'warn', body: 'Tranche 2 drawdown gates: 1 of 4 met. Run-rate gate fails until April closes ≥ 80% take-or-pay for the third consecutive month — currently 79.3%.' },
    { id: 'fbk-tn2', severity: 'info', body: 'Tranche 1 capital fully drawn at $22.0M. Equity cushion of $20.4M committed but undrawn until Tranche 2 trigger.' },
  ],
  financials: [
    { id: 'fbk-f1', severity: 'info', body: 'DSCR trailing 6 months averages 1.18× — below the 1.30× covenant floor. April reading of 1.34× lifts the trailing average over the threshold from May onward if held.' },
    { id: 'fbk-f2', severity: 'warn', body: 'Receivables aged 31–60 carry $280k against $920k current. April invoice settlement is the binary determinant of next month\'s ageing covenant test.' },
  ],
  compliance: [
    { id: 'fbk-co1', severity: 'warn', body: 'Hauler 02 holds account for 80% of corridor weighbridge holds in the 30-day window. Coaching the Hauler 02 dispatcher on pre-departure verification is the single highest-leverage action.' },
    { id: 'fbk-co2', severity: 'warn', body: 'Driver 02-117 Class E licence expires 02 May 2026 — 11 days out. Renewal appointment not booked. One driver gap on Hauler 02 shift pattern from that date.' },
  ],
  alerts: [
    { id: 'fbk-a1', severity: 'info', body: 'Two of four critical items concentrate on Hauler 02 (axle breach + licence expiry). Coaching session resolves the upstream pattern; the licence requires a separate DVLA appointment.' },
  ],
  corridor: [
    { id: 'fbk-cor1', severity: 'info', body: 'Active convoys split 2 laden southbound, 1 empty northbound. Cycle time tracking 25.6 hours against the 25.0-hour target.' },
  ],
  convoys: [
    { id: 'fbk-cv1', severity: 'warn', body: 'Convoy C-041 ran 28 minutes late on the northbound leg. Single-event, not systemic — cycle time stays inside the 7-day p95 band.' },
  ],
  trips: [
    { id: 'fbk-tp1', severity: 'info', body: 'Northbound (empty) trips run at a $5,422 cost with no offsetting revenue. Southbound (laden) trips clear $14,346 margin on $6,558 cost — the corridor pays one-way.' },
  ],
  haulers: [
    { id: 'fbk-h1', severity: 'info', body: '5 haulers onboarded against a Tranche 1 target of 5. Hauler 02 is the largest contributor at 35% of corridor tonnage but also the source of 80% of weighbridge holds.' },
  ],
  reports: [
    { id: 'fbk-r1', severity: 'info', body: 'GIBDLC March pack delivered 05 April against the 5-day SLA. April pack due 07 May; content preview reflects the current 79.3% run-rate.' },
    { id: 'fbk-r2', severity: 'warn', body: 'Regulatory filings pack has two DUE items — DVLA Q1 roadworthy (30 April) and EPA monthly (07 May). Both need the Nyinahin loading-zone annex before submission.' },
  ],
  fleet: [
    { id: 'fbk-fl1', severity: 'warn', body: '8 rigs carry maintenance flags. 5 sit on Hauler 02 — axle alignment from the weighbridge cadence. Dispatcher coaching is the upstream action.' },
    { id: 'fbk-fl2', severity: 'info', body: 'Road-worthy pipeline: 18 trucks across Hauler 02 and Hauler 04 within 30 days of expiry. DVLA renewal slot booked 30 April.' },
  ],
  drivers: [
    { id: 'fbk-dr1', severity: 'warn', body: 'Driver 02-117 Class E licence expires 02 May 2026 — 11 days out, renewal unbooked. One Hauler 02 shift gap from that date.' },
    { id: 'fbk-dr2', severity: 'info', body: '1.55 drivers per rig covers shift rotation. 3 rest-hour warnings this week, all Hauler 02. Zero breach events across the remaining haulers.' },
  ],
  maintenance: [
    { id: 'fbk-m1', severity: 'warn', body: '4 rigs critical, 6 in workshop. Hauler 02 carries 3 of 4 criticals — axle alignment post-weighbridge. Workshop turnaround averaging 2.4 days.' },
    { id: 'fbk-m2', severity: 'info', body: '12 rigs crossed the 20,000 km service interval since last workshop visit. Hauler 04 carries 5 — book before the next laden trip.' },
  ],
  settings: [
    { id: 'fbk-st1', severity: 'info', body: '4 roles across 6 users. axis_admin holds 2; remaining 4 split across ops, hauler admin, and lender desk. Token TTL 12 hours, opaque bearer.' },
    { id: 'fbk-st2', severity: 'warn', body: 'Hauler 03 Geotab integration reports errored probe count > 0 in the last 24 hours. Last sync 19 April 09:15 — retry cleared, monitor the next window.' },
  ],
};

// Curated demo-mode replies. Keyed by the exact chip text from
// FALLBACK_CHIPS so a chip click returns a voice-compliant, numerically
// grounded paragraph instead of the generic "demonstration mode" stub.
// Each closure receives the live corridor snapshot — run-rate, SLA,
// tonnage — so the paragraph reflects what the page just rendered.
function worstSla(haulers = []) {
  if (!haulers.length) return null;
  return [...haulers].sort((a, b) => a.sla - b.sla)[0];
}
function largestContributor(haulers = []) {
  if (!haulers.length) return null;
  return [...haulers].sort((a, b) => b.mtd_delivered - a.mtd_delivered)[0];
}
function runRatePct(ctx) {
  const c = ctx?.tonnes?.contracted_mtd ?? 0;
  const d = ctx?.tonnes?.delivered_mtd  ?? 0;
  if (!c) return 0;
  return Math.round((d / c) * 1000) / 10;
}

const CURATED_REPLIES = {
  today: {
    'Why is take-or-pay below floor?': (ctx) => {
      const rate = runRatePct(ctx);
      const worst = worstSla(ctx.haulers);
      return `Delivered MTD sits at ${rate}% of contracted against the 80% take-or-pay floor. ${worst ? worst.name + ' drags hardest at ' + worst.sla.toFixed(1) + '% SLA' : 'Aggregate SLA is below target'}, compounded by 4 Hauler 02 weighbridge holds costing 196 minutes. Coach the Hauler 02 dispatcher to recover the 373-tonne shortfall.`;
    },
    'Which hauler drags SLA most?': (ctx) => {
      const worst = worstSla(ctx.haulers);
      if (!worst) return 'SLA attainment is even across the corridor at the moment.';
      return `${worst.name} holds the lowest SLA at ${worst.sla.toFixed(1)}% against a corridor-weighted ${ctx.sla_pct}%. Root cause is axle-load holds — 4 events in 30 days. Coach the dispatcher on pre-departure verification before the 07 May filings window.`;
    },
    'Summarise the dominant story for tomorrow.': (ctx) => {
      const rate = runRatePct(ctx);
      return `Corridor sits at ${rate}% run-rate with 10 days of April remaining; a 373-tonne shortfall separates delivered MTD from the 80% take-or-pay floor. DVLA Q1 roadworthy is due 30 April — 8 days out. The binary item is whether Hauler 02 re-enters the day clean.`;
    },
  },
  contract: {
    'How many tonnes to clear the take-or-pay floor?': (ctx) => {
      const monthly = ctx.tonnes?.contracted_monthly ?? 83_333;
      const floor = Math.round(monthly * 0.80);
      const delivered = ctx.tonnes?.delivered_mtd ?? 0;
      const gap = Math.max(0, floor - delivered);
      return `The 80% floor for April is ${floor.toLocaleString()} tonnes against ${delivered.toLocaleString()} delivered MTD — a ${gap.toLocaleString()}-tonne gap. At current run-rate that closes on 30 April only if Hauler 02 holds clear and Hauler 04 lifts to contracted share.`;
    },
    'What changes if Hauler 02 is taken offline?': (ctx) => {
      const h02 = ctx.haulers?.find((h) => h.name.includes('02'));
      if (!h02) return 'Hauler 02 is not active on the corridor at present.';
      return `${h02.name} contributes ${h02.mtd_delivered.toLocaleString()} tonnes MTD against ${h02.contracted} contracted trucks. Pulling them offline cuts 35% of corridor tonnage and drops the April projection to 62% of floor — GIBDLC bills the floor differential. Shift the load to Hauler 01 and Hauler 04 first.`;
    },
    'Forecast May attainment at current run-rate.': (ctx) => {
      const rate = runRatePct(ctx);
      return `Holding the ${rate}% April run-rate through May clears the floor on the 22nd and finishes the month at 86-88% of contracted — $360k above the take-or-pay billing line. Hauler 02 weighbridge cadence is the single largest variance risk for the month.`;
    },
  },
  tariff: {
    'What does the next reindexation look like?': () =>
      'Next reindexation 01 May 2026 — 9 days out. NPA diesel tracking GHS 16.10 against a GHS 15.72 base drives a +2.42% fuel contribution; GSS CPI at 101.8 adds +1.80%. Effective tariff lifts to approximately $24.41 per tonne from $24.36 today.',
    'How sensitive is the tariff to a 5% diesel jump?': () =>
      'The fuel component is 40% of tariff. A 5% diesel spike raises the effective tariff by $0.48 per tonne — $480 per 1,000-tonne convoy, or $16k on April projected throughput. Pass-through is immediate; the 30-day settlement window absorbs the timing mismatch.',
    'Compare CPI vs fuel contribution this quarter.': () =>
      'Fuel contributed +2.42% to tariff Q1; CPI +1.80%. Fuel has carried the indexation weight as NPA diesel pricing tracked the cedi depreciation cycle. CPI is the steadier driver — the Q1 GSS print was the lowest since December.',
  },
  tranches: {
    'Which Tranche 2 gate closes first?': () =>
      'Hauler count gate closes first — 5 of 5 onboarded, met. Run-rate gate follows once April closes ≥80% take-or-pay for a third consecutive month. Compliance gate gates on the axle-load record; that clears if Hauler 02 holds the next 30 days without a new breach.',
    'When does the run-rate gate likely close?': () =>
      'Base case is June 2026 assuming April closes at 81% and May holds 82%+. That requires Hauler 02 coaching to land before 02 May and the Nyinahin weighbridge cadence to normalise. The drawdown trigger sits at the July board.',
    'What blocks Tranche 2 today?': () =>
      'One of four gates met. Blockers: April run-rate (79.3% vs 80% floor), compliance gate (Hauler 02 axle events in last 30), and working capital gate (pending the 18 April invoice settlement). Hauler 02 is the upstream variable for two of the three.',
  },
  financials: {
    'How much DSCR headroom is at risk in May?': () =>
      'April DSCR tracks 1.34× against the 1.30× covenant — 3.1% headroom. If Hauler 02 absorbs another weighbridge week at the 30-day cadence, May settles near 1.31× and the trailing three-month average drops inside the breach band.',
    "What's the breach-adjacent receivables number?": () =>
      'Receivables 3.2% in the 61–90 band against the 5% covenant ceiling — the first breach-adjacent reading since contract signing. Clears 15 May if the 18 April invoice settles on terms. Escalate to GIBDLC treasury desk if it stretches past 28 April.',
    'Show the cashflow trough in the next 30 days.': () =>
      'Trough lands 02 May at −$180k after the DVLA filing fee and the Hauler 02 maintenance settlement. Equity cushion of $20.4M is committed but undrawn; the trough is funded out of working capital. Normal cadence restores by 10 May on the GIBDLC April pack payment.',
  },
  compliance: {
    'Which hauler should I coach first?': (ctx) => {
      const worst = worstSla(ctx.haulers) ?? { name: 'Hauler 02' };
      return `${worst.name}. 4 weighbridge holds in 30 days against a corridor total of 5, 196 minutes of forced off-load, $2,840 in opportunity cost. Coaching the dispatcher on pre-departure verification is the single highest-leverage action.`;
    },
    'How many licence renewals fall in May?': () =>
      'Two. Driver 02-117 Class E licence expires 02 May 2026 — 11 days out, renewal unbooked. Driver 01-034 medical certificate expires 18 May. Book the DVLA appointments before 30 April to avoid a Hauler 02 shift gap.',
    'What filings are due this week?': () =>
      'DVLA Q1 roadworthy renewal is due 30 April — 18 trucks across Hauler 02 and Hauler 04. EPA dust-suppression monthly is due 07 May. Both need the Nyinahin loading-zone annex; Adwoa Mensah owns the pack.',
  },
  alerts: {
    'Walk me through the critical alerts.': () =>
      'Two critical items, both Hauler 02. Axle-load hold sequence — 4 events in 30 days, most recent 19 April. Class E licence expiry — Driver 02-117, 02 May. Both concentrate on one hauler; coaching and a DVLA appointment resolves the pattern.',
    'Which alerts cluster on one hauler?': () =>
      'Hauler 02 carries 4 of 5 corridor axle-load alerts and 1 of 2 critical driver licence expiries — 5 of the 7 total open alerts. Root cause is dispatcher pre-departure verification; one coaching session collapses the cluster.',
    'What resolved today?': () =>
      'Two items. Convoy C-041 northbound late-run closed on arrival at Takoradi at 14:12. Hauler 03 Geotab probe cleared on the 09:15 retry — integration back to live. No critical items resolved today.',
  },
  corridor: {
    'Summarise active convoy posture.': () =>
      '3 active convoys. C-042 laden southbound at km 211, on schedule. C-041 laden southbound at km 134, running 28 minutes late. C-044 empty northbound at km 88. Cycle time tracking 25.6 hours against the 25.0-hour target.',
    'Where are the slow points today?': () =>
      'Nyinahin weighbridge — 38-minute average hold time today against a 12-minute target. Hauler 02 carries the bulk. A secondary slowdown at the Takoradi port gate earlier this morning cleared by 11:00.',
    'How many convoys are en route?': () =>
      '3 convoys en route: 2 laden southbound, 1 empty northbound. 2 additional convoys staged at Nyinahin loading for the 16:00 departure; 1 at Takoradi discharge for the 18:30 turn.',
  },
  convoys: {
    'Which convoy is at risk?': () =>
      'C-041. 28 minutes behind the northbound schedule with the Takoradi cut-off at 19:00. Single-event, not systemic — cycle time p95 holds. Controller should raise the driver for a status check at km 180.',
    'Compare cycle times across phases.': () =>
      'Nyinahin load: 1.8 hours (target 1.5). Southbound run: 8.2 hours (target 8.0). Takoradi discharge: 1.1 hours (target 1.0). Northbound empty: 7.9 hours (target 7.5). Load and discharge carry the slippage, not the run.',
    'How many empties are inbound?': () =>
      '1 empty convoy inbound — C-044 at km 88 northbound, ETA Nyinahin 18:40. 2 more empties turn at Takoradi this evening; the morning northbound stack rebuilds to 3 by 22:00.',
  },
  trips: {
    'Which route loses the most money?': () =>
      'Northbound (empty) is cost-only — $5,422 per trip against no revenue. Southbound (laden) clears $14,346 margin on $6,558 cost. The corridor pays one-way; rebalancing with a reverse-haul commodity sits on the Phase 4 strategy backlog.',
    "What's the worst delay window this week?": () =>
      'Tuesday 16 April 07:00–09:00 at the Nyinahin weighbridge — 4 Hauler 02 trucks held, 196 minutes off-load, Takoradi cut-off slipped by 42 minutes. No other window ran more than 30 minutes late this week.',
    'Show top haulers by tonnage today.': (ctx) => {
      const top = largestContributor(ctx.haulers);
      if (!top) return 'No tonnage posted yet today.';
      return `${top.name} leads today at ${top.mtd_delivered.toLocaleString()} tonnes MTD, followed by the balance of the roster. Hauler 02 remains the largest contributor at 35% of corridor tonnage despite the axle-load cadence.`;
    },
  },
  haulers: {
    'Which hauler should I onboard next?': () =>
      'Priority is a sixth hauler by September to lift Tranche 1 capacity ahead of the Tranche 2 trigger. Recommendation: an EPA-zone qualified operator with ≥20 contracted trucks to absorb the Hauler 02 weighbridge risk without concentration.',
    "What's Hauler 02 contributing this month?": (ctx) => {
      const h02 = ctx.haulers?.find((h) => h.name.includes('02'));
      if (!h02) return 'Hauler 02 is not active on the corridor at present.';
      return `${h02.mtd_delivered.toLocaleString()} tonnes MTD against ${h02.mtd_contracted.toLocaleString()} contracted — ${h02.sla.toFixed(1)}% SLA. Largest contributor by volume, largest source of weighbridge holds, largest coaching opportunity. Net margin per tonne holds at $14.30 despite the 196 minutes of off-load.`;
    },
    'Who has the cleanest SLA?': (ctx) => {
      const sorted = [...(ctx.haulers ?? [])].sort((a, b) => b.sla - a.sla);
      const top = sorted[0];
      if (!top) return 'No hauler has posted a full SLA window yet this month.';
      return `${top.name} at ${top.sla.toFixed(1)}% — zero axle-load events in 30 days, one advisory warning. The blueprint for the Hauler 02 coaching pack: pre-departure verification, loaded weight sign-off, driver brief at Nyinahin gate.`;
    },
  },
  reports: {
    'When is the next GIBDLC pack due?': () =>
      'GIBDLC April monthly pack is due 07 May 2026 — 15 days out. March pack delivered 05 April against the 5-day SLA, signed by GIBDLC contract ops. Content preview reflects the current 79.3% run-rate; the DSCR and receivables appendices are already final.',
    "What's blocking the filings pack?": () =>
      'Two items on the Q2 filings pack are DUE. DVLA Q1 roadworthy renewal (30 April) needs the axle-load annexe for 18 trucks across Hauler 02 and Hauler 04. EPA monthly (07 May) needs the Nyinahin loading-zone dust-suppression log. Adwoa Mensah owns both.',
    'Summarise the last lender pack.': () =>
      'Q1 2026 lender pack delivered 14 April 2026 to project.finance@ecobank.com. 11 pages. Headline: DSCR trailing three-month 1.24×, covenant held. Receivables 3.2% at 61–90 days — first breach-adjacent print since contract signing. Next pack due 20 July.',
  },
  fleet: {
    'Which rigs are due for service this week?': () =>
      '12 rigs have crossed the 20,000 km service interval. Hauler 04 carries 5 — including H04-0009 at 22,400 km. Book before the next laden trip; workshop turnaround averages 2.4 days so the slot needs to land before 28 April.',
    'What\'s the oldest rig still on the corridor?': () =>
      'H02-0017 — 2011 Sinotruk HOWO, 487,000 km on the clock, still in rotation. Second-oldest is H01-0004 at 461,000 km. Both carry elevated fuel burn at 44 L/100 km laden against a fleet average of 38.',
    'How does fleet efficiency compare across haulers?': () =>
      'Fleet average is 38 L/100 km laden. Hauler 01 leads at 35.4; Hauler 03 and Hauler 05 cluster around 37. Hauler 02 trails at 41.2 — a direct consequence of axle alignment slippage from the weighbridge cadence. Coaching recovers roughly $240/trip.',
  },
  drivers: {
    'Who has rest-hour breach this week?': () =>
      'Zero breaches. 3 warnings in the 48–56 hour band — all Hauler 02 drivers on the Nyinahin corridor rotation. Monday 00:00 Africa/Accra rollover clears the board; Hauler 02 dispatcher should rotate relief pool for the remaining week.',
    'Which driver licences expire in the next 30 days?': () =>
      'Two. Driver 02-117 Class E expires 02 May 2026 — 11 days, unbooked. Driver 01-034 medical clearance expires 18 May. Book both DVLA appointments before 30 April to avoid a Hauler 02 shift gap on the 2 May pattern.',
    'What\'s the safety score trend across the roster?': () =>
      'Roster average 87/100, trending +1.2 points over the 8-week window. Hauler 02 drivers sit 4 points below average; Hauler 01 and Hauler 05 pull the composite up. Two drivers flagged for coaching — both tied to the harsh-braking cluster on the southbound descent at km 180.',
  },
  maintenance: {
    'Which rigs are blocking the corridor today?': () =>
      '4 rigs pulled from service. H02-0033, H02-0041 (axle alignment), H04-0009 (brake compressor), H03-0022 (chassis crack — extended workshop). The Hauler 02 pair share a root cause; workshop sign-off scheduled for 25 April.',
    'What\'s the backlog in the workshop?': () =>
      '6 rigs in bays, 4 waiting for parts. Longest wait is H03-0022 at 11 days on a chassis repair — parts lead time from Tema port. Workshop turnaround averages 2.4 days for routine services, 6.8 days for structural items.',
    'How much workshop time was logged this week?': () =>
      '148 workshop hours across 9 rigs. 88 hours on scheduled services, 60 hours on unscheduled repairs — the unscheduled figure is 40% above the 7-day p50 and tracks the Hauler 02 axle cadence. Spend $14,400 against a monthly budget of $58,000.',
  },
  settings: {
    'Which integrations are live right now?': () =>
      '1 of 5 hauler integrations live — Hauler 01 Samsara, last sync 19 April 14:32. 3 pending credential setup (Hauler 02, 04, 05). Hauler 03 Geotab probe errored in the last 24 hours; retry cleared at 09:15 on 19 April, monitor the next window.',
    'Who has write access across the platform?': () =>
      '3 users with write scope. 2 axis_admin (Akosua Mensah, systems lead), 1 axis_ops (Kwame Boateng, dispatch). Hauler admins are scoped to their own hauler. Lender role is read-only. Role edits and audit history land with Phase 11 identity provider.',
    'When was the last credential rotation?': () =>
      'Credential rotation is deferred to Phase 11 alongside signed JWT and the identity provider handover. Current scheme is opaque bearer tokens with a 12-hour TTL, reissued on login. No scheduled rotation in the v1 surface.',
  },
};

function curatedChipReply(page, question, context) {
  const table = CURATED_REPLIES[page];
  if (!table) return null;
  const entry = table[question.trim()];
  if (!entry) return null;
  try { return entry(context ?? {}); }
  catch { return null; }
}

const FALLBACK_CHIPS = {
  today:       ['Why is take-or-pay below floor?', 'Which hauler drags SLA most?', 'Summarise the dominant story for tomorrow.'],
  contract:    ['How many tonnes to clear the take-or-pay floor?', 'What changes if Hauler 02 is taken offline?', 'Forecast May attainment at current run-rate.'],
  tariff:      ['What does the next reindexation look like?', 'How sensitive is the tariff to a 5% diesel jump?', 'Compare CPI vs fuel contribution this quarter.'],
  tranches:    ['Which Tranche 2 gate closes first?', 'When does the run-rate gate likely close?', 'What blocks Tranche 2 today?'],
  financials:  ['How much DSCR headroom is at risk in May?', 'What\'s the breach-adjacent receivables number?', 'Show the cashflow trough in the next 30 days.'],
  compliance:  ['Which hauler should I coach first?', 'How many licence renewals fall in May?', 'What filings are due this week?'],
  alerts:      ['Walk me through the critical alerts.', 'Which alerts cluster on one hauler?', 'What resolved today?'],
  corridor:    ['Summarise active convoy posture.', 'Where are the slow points today?', 'How many convoys are en route?'],
  convoys:     ['Which convoy is at risk?', 'Compare cycle times across phases.', 'How many empties are inbound?'],
  trips:       ['Which route loses the most money?', 'What\'s the worst delay window this week?', 'Show top haulers by tonnage today.'],
  haulers:     ['Which hauler should I onboard next?', 'What\'s Hauler 02 contributing this month?', 'Who has the cleanest SLA?'],
  reports:     ['When is the next GIBDLC pack due?', 'What\'s blocking the filings pack?', 'Summarise the last lender pack.'],
  fleet:       ['Which rigs are due for service this week?', 'What\'s the oldest rig still on the corridor?', 'How does fleet efficiency compare across haulers?'],
  drivers:     ['Who has rest-hour breach this week?', 'Which driver licences expire in the next 30 days?', 'What\'s the safety score trend across the roster?'],
  maintenance: ['Which rigs are blocking the corridor today?', 'What\'s the backlog in the workshop?', 'How much workshop time was logged this week?'],
  settings:    ['Which integrations are live right now?', 'Who has write access across the platform?', 'When was the last credential rotation?'],
};

function _hasKey() {
  return !!(Anthropic && process.env.ANTHROPIC_API_KEY);
}

function _client() {
  if (!_hasKey()) return null;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function sanitise(text) {
  if (!text) return text;
  // If the model slipped a banned term through, fall back. Better to refuse
  // than to publish off-voice copy.
  return BANNED.test(text) ? null : text.trim();
}

async function observe(page, context = {}) {
  // Cache key includes context fingerprint so the synth picks up state
  // changes (resolved alerts, failed probes) within its TTL window.
  const cacheKey = `obs:${page}:${JSON.stringify(context).length}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  if (!_hasKey()) {
    // Phase 28 — prefer live synthesis over hand-authored strings. The
    // synth reads the same state as the alert generator and Today feed,
    // so the Intelligence panel stays honest in demo mode.
    const synthesized = observationSynth.synthesize(page, context);
    const result = {
      observations: synthesized ?? FALLBACK_OBSERVATIONS[page] ?? FALLBACK_OBSERVATIONS.today,
      chips:        FALLBACK_CHIPS[page] ?? FALLBACK_CHIPS.today,
      live:         false,
      synthesized:  !!synthesized,
    };
    cache.set(cacheKey, result);
    return result;
  }

  const client = _client();
  const synthHints = observationSynth.synthesize(page, context);
  const hintBlock = synthHints
    ? `\n\nState-derived facts (ground your observations in these numbers — do not invent figures that contradict them):\n${synthHints.map((o) => `- ${o.body}`).join('\n')}\n`
    : '';
  const userMsg = `Page: ${page}

Corridor snapshot:
${JSON.stringify(context, null, 2)}${hintBlock}

Produce 2–4 observation cards for this page. Each observation must be one of severity "warn" or "info". Each body must be ≤ 25 words, name a hauler or asset where relevant, name the cost in tonnes / minutes / dollars / percent, and end with a recommended action where natural.

Return strict JSON, no prose: {"observations": [{"id": "obs-X", "severity": "warn"|"info", "body": "..."}], "chips": ["question 1", "question 2", "question 3"]}

Chips are 3 short next-question suggestions specific to this page.`;

  try {
    const response = await client.messages.create({
      model:     OBS_MODEL,
      max_tokens: 1024,
      system:    SYSTEM_PROMPT,
      messages:  [{ role: 'user', content: userMsg }],
    });

    const raw = response.content?.[0]?.text ?? '';
    const json = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}');
    const observations = (json.observations ?? [])
      .map((o) => ({ ...o, body: sanitise(o.body) }))
      .filter((o) => o.body);
    const chips = (json.chips ?? FALLBACK_CHIPS[page] ?? []).slice(0, 4);

    const result = { observations, chips, live: true };
    cache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[intelligence.observe]', err.message);
    const synthesized = observationSynth.synthesize(page, context);
    const fallback = {
      observations: synthesized ?? FALLBACK_OBSERVATIONS[page] ?? FALLBACK_OBSERVATIONS.today,
      chips:        FALLBACK_CHIPS[page] ?? FALLBACK_CHIPS.today,
      live:         false,
      synthesized:  !!synthesized,
      error:        err.message,
    };
    return fallback;
  }
}

async function chat(question, context = {}, page = 'today') {
  if (!_hasKey()) {
    const curated = curatedChipReply(page, question, context);
    if (curated) {
      return { reply: curated, live: false, source: 'curated' };
    }
    return {
      reply: `AXIS Intelligence is in demonstration mode — no live API credential. A live deployment would answer "${question.slice(0, 80)}" against the corridor snapshot in one paragraph.`,
      live: false,
    };
  }

  const client = _client();
  const userMsg = `Page: ${page}
Question: ${question}

Corridor snapshot:
${JSON.stringify(context, null, 2)}

Answer in one dense paragraph, ≤ 60 words. Name the haulers, costs, and dates referenced. End with a recommended action where appropriate.`;

  try {
    const response = await client.messages.create({
      model:     CHAT_MODEL,
      max_tokens: 512,
      system:    SYSTEM_PROMPT,
      messages:  [{ role: 'user', content: userMsg }],
    });
    const raw = response.content?.[0]?.text ?? '';
    const reply = sanitise(raw);
    if (!reply) {
      return { reply: 'AXIS Intelligence drafted a reply that failed the voice check. Try a different phrasing.', live: true, blocked: true };
    }
    return { reply, live: true };
  } catch (err) {
    console.error('[intelligence.chat]', err.message);
    return { reply: `Live AXIS Intelligence is unavailable — ${err.message}`, live: false, error: err.message };
  }
}

module.exports = { observe, chat, _hasKey };
