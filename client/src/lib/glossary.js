/*
 * glossary.js — the plain-language term dictionary.
 *
 * The single source of truth for what every acronym and piece of jargon on
 * the platform actually means, written so a non-specialist can follow it.
 * Powers two things (see PlainModeContext):
 *   1. The always-on explainer layer — the <Term> primitive reads `plain`
 *      to show a definition on demand.
 *   2. Plain mode — when on, <Term> also uses `expand` to spell out acronyms
 *      inline.
 *
 * Register: port-authority plain English, not marketing. State what the term
 * IS and why it matters. No "unlock", no "leverage", no cheerleading.
 *
 * Keys are lowercase slugs. Look-up is slug-based and forgiving of spacing /
 * hyphen / case variation (see termFor()).
 *
 * Each entry:
 *   term    — the canonical short form as it appears in the UI (e.g. "DSCR")
 *   expand  — the full spelled-out form, or null if the term is already words
 *   plain   — one or two sentences a non-technical reader can follow
 *   matter  — optional: why it matters here / how to read a good vs bad number
 */

export const GLOSSARY = {
  dscr: {
    term: 'DSCR',
    expand: 'Debt Service Coverage Ratio',
    plain: 'How many times over the cash the business earns covers the loan repayments due in the same period.',
    matter: 'Above 1.0× means the loan is comfortably covered by earnings. Lenders here look for at least 1.30×.',
  },
  'take-or-pay': {
    term: 'take-or-pay',
    expand: null,
    plain: 'A contract term where the buyer pays for an agreed minimum amount of haulage whether or not they actually ship it.',
    matter: 'It guarantees a floor of revenue for the haulier regardless of how much ore actually moves.',
  },
  tranche: {
    term: 'tranche',
    expand: null,
    plain: 'One instalment of a larger sum of funding, released in stages as the project hits agreed milestones.',
    matter: 'The build-out draws capital in four tranches as capacity scales from 1.0 to 5.0 million tonnes a year.',
  },
  covenant: {
    term: 'covenant',
    expand: null,
    plain: 'A promise written into the loan agreement — a condition the business must keep meeting, such as holding earnings above a set level.',
    matter: 'Breaking a covenant lets the lender step in, so staying clear of the limit is watched closely.',
  },
  ebitda: {
    term: 'EBITDA',
    expand: 'Earnings Before Interest, Tax, Depreciation and Amortisation',
    plain: 'A measure of the cash a business generates from its core operations, before financing and accounting deductions.',
    matter: 'Used as a clean, comparable proxy for operating performance.',
  },
  dso: {
    term: 'DSO',
    expand: 'Days Sales Outstanding',
    plain: 'The average number of days it takes to get paid after sending an invoice.',
    matter: 'Lower is better — it means cash comes in faster after the work is done.',
  },
  indexation: {
    term: 'indexation',
    expand: null,
    plain: 'Automatically adjusting a price each period to track underlying costs, so it keeps pace with things like fuel and inflation.',
    matter: 'The haulage rate is re-set monthly, part of it tied to the national diesel price.',
  },
  'pass-through': {
    term: 'pass-through',
    expand: null,
    plain: 'A cost that is handed straight on to the customer rather than absorbed by the haulier.',
    matter: 'Diesel is largely passed through, so a fuel-price rise does not erode the margin.',
  },
  'axle-load': {
    term: 'axle-load',
    expand: null,
    plain: 'The weight carried by a single axle of a truck. Roads have legal limits to prevent damage.',
    matter: 'Ghana caps this under regulation LI 2180; going over risks fines and road wear.',
  },
  'li-2180': {
    term: 'LI 2180',
    expand: 'Legislative Instrument 2180',
    plain: "Ghana's road-traffic regulation that sets the legal weight limits for trucks by axle.",
    matter: 'Compliance is checked at weighbridges along the corridor.',
  },
  hos: {
    term: 'HOS',
    expand: 'Hours of Service',
    plain: 'The rules limiting how long a driver may be at the wheel before a mandatory rest, to prevent fatigue.',
    matter: 'Breaching HOS is a safety flag and triggers coaching.',
  },
  sla: {
    term: 'SLA',
    expand: 'Service Level Agreement',
    plain: 'A written standard for how the service must perform — for example, the share of trips that must arrive on time.',
    matter: 'Missing the SLA can carry a penalty under the contract.',
  },
  'run-rate': {
    term: 'run-rate',
    expand: null,
    plain: "Today's performance projected forward as if it continued at the same pace for a full year.",
    matter: 'A quick way to see whether current tonnage is on track to hit the annual target.',
  },
  drawdown: {
    term: 'drawdown',
    expand: null,
    plain: 'The act of taking an agreed instalment of loan money once its conditions are met.',
    matter: 'Each capital tranche is drawn down when its milestone gate is cleared.',
  },
  receivable: {
    term: 'receivable',
    expand: null,
    plain: 'Money that has been invoiced and is owed to the business but not yet paid.',
    matter: 'A build-up of ageing receivables ties up cash the business needs to operate.',
  },
  reconciliation: {
    term: 'reconciliation',
    expand: null,
    plain: 'Checking two records against each other — for example invoices sent versus payments received — and resolving any gap.',
    matter: 'A reconciliation gap flags amounts that do not yet match up.',
  },
  escalation: {
    term: 'escalation',
    expand: null,
    plain: 'A pre-agreed increase in a price over time, or the act of raising an issue to a higher authority for a decision.',
    matter: null,
  },
  mtpa: {
    term: 'Mtpa',
    expand: 'Million tonnes per annum',
    plain: 'A measure of throughput: how many million tonnes of ore move over the corridor in a year.',
    matter: 'The programme scales from 1.0 to 5.0 Mtpa across its tranches.',
  },
  gvw: {
    term: 'GVW',
    expand: 'Gross Vehicle Weight',
    plain: 'The total weight of a truck including its load — the figure checked against legal limits.',
    matter: null,
  },
  'tonne-km': {
    term: 'tonne-km',
    expand: 'tonne-kilometre',
    plain: 'One tonne of cargo carried one kilometre. The standard unit for pricing and measuring haulage work.',
    matter: 'The tariff is quoted per tonne-km, so it fairly reflects both weight and distance.',
  },
  capex: {
    term: 'CAPEX',
    expand: 'Capital Expenditure',
    plain: 'Money spent on long-lived assets — trucks, depots, equipment — rather than day-to-day running costs.',
    matter: null,
  },
  'payment-security': {
    term: 'payment security',
    expand: null,
    plain: 'A safeguard — such as an escrow account or bank guarantee — that ensures the haulier gets paid even if the buyer defaults.',
    matter: 'It de-risks the contract for lenders assessing whether revenue is dependable.',
  },
  weighbridge: {
    term: 'weighbridge',
    expand: null,
    plain: 'A roadside scale that weighs trucks to check they are within the legal axle and gross-weight limits.',
    matter: null,
  },
  laden: {
    term: 'laden',
    expand: null,
    plain: 'A truck running loaded with cargo, as opposed to running empty on the return leg.',
    matter: null,
  },
  roadworthy: {
    term: 'roadworthy',
    expand: null,
    plain: 'Certified as safe and legal to drive, following the official DVLA inspection.',
    matter: null,
  },
  giadec: {
    term: 'GIADEC',
    expand: 'Ghana Integrated Aluminium Development Corporation',
    plain: "The state body overseeing development of Ghana's bauxite and aluminium industry.",
    matter: null,
  },
  gibdlc: {
    term: 'GIBDLC',
    expand: 'Ghana Integrated Bauxite & Development Land Company',
    plain: 'The counterparty on the haulage contract — the entity the corridor moves ore for.',
    matter: null,
  },
  npa: {
    term: 'NPA',
    expand: 'National Petroleum Authority',
    plain: "The regulator that sets Ghana's official fuel prices, which the diesel part of the tariff tracks.",
    matter: null,
  },
  dvla: {
    term: 'DVLA',
    expand: 'Driver and Vehicle Licensing Authority',
    plain: 'The Ghanaian authority that licenses vehicles and issues roadworthy certificates.',
    matter: null,
  },
  fms: {
    term: 'FMS',
    expand: 'Fleet Management System',
    plain: 'The in-cab telematics platform (such as Loconav) that tracks a truck’s location, speed and status.',
    matter: null,
  },
  'cycle-time': {
    term: 'cycle time',
    expand: null,
    plain: 'How long one full round trip takes — loaded out, empty back — including loading, driving and unloading.',
    matter: 'A round trip on this corridor runs about 600 km and 13–15 hours.',
  },
  hse: {
    term: 'HSE',
    expand: 'Health, Safety and Environment',
    plain: 'The set of standards and incident-tracking that keep operations safe for people and the surroundings.',
    matter: 'Incidents are counted per million tonne-km so the rate is comparable as volume grows.',
  },
  'ageing-bucket': {
    term: 'ageing bucket',
    expand: null,
    plain: 'A band that groups unpaid invoices by how overdue they are — for example 0–30, 31–60, and 60+ days.',
    matter: 'Money sitting in the older buckets is at greater risk and ties up cash.',
  },
  settlement: {
    term: 'settlement',
    expand: null,
    plain: 'Paying and clearing what is owed on an invoice, so the account is squared between the parties.',
    matter: null,
  },
  'composite-score': {
    term: 'composite score',
    expand: null,
    plain: 'A single rating that rolls several measures — safety, fuel use, on-time record — into one comparable number.',
    matter: 'It lets drivers or haulers be ranked fairly on more than one factor at once.',
  },
  fatigue: {
    term: 'fatigue',
    expand: null,
    plain: 'Driver tiredness that raises accident risk. Tracked from driving hours and rest patterns.',
    matter: 'A fatigue flag prompts enforced rest before the driver continues.',
  },
  'rest-breach': {
    term: 'rest breach',
    expand: null,
    plain: 'A case where a driver went longer than the rules allow without a required rest break.',
    matter: 'Breaches are safety events and feed into coaching.',
  },
  deadhead: {
    term: 'deadhead',
    expand: null,
    plain: 'Running a truck empty — typically the return leg after a load is delivered.',
    matter: 'Empty running still costs fuel and time, so reducing it improves economics.',
  },
  gate: {
    term: 'gate',
    expand: null,
    plain: 'A checkpoint of conditions that must all be met before the next stage — or the next slice of funding — is allowed to proceed.',
    matter: 'Each capital tranche is released only once its gate is cleared.',
  },
  'effective-rate': {
    term: 'effective rate',
    expand: null,
    plain: 'The actual price being earned per unit of haulage once every adjustment and index has been applied.',
    matter: null,
  },
  headroom: {
    term: 'headroom',
    expand: null,
    plain: 'How much margin of safety sits between the current figure and the limit it must not cross.',
    matter: 'More headroom above a covenant floor means less risk of breaching it.',
  },
  'stress-test': {
    term: 'stress test',
    expand: null,
    plain: 'Deliberately changing key assumptions — like fuel price or exchange rate — to see how badly the numbers hold up under pressure.',
    matter: 'It shows whether the business still covers its loans if conditions worsen.',
  },
  escrow: {
    term: 'escrow',
    expand: null,
    plain: 'Money held by a neutral third party and released only when agreed conditions are met — a safeguard for both sides.',
    matter: null,
  },
  throughput: {
    term: 'throughput',
    expand: null,
    plain: 'The volume of ore actually moved over the corridor in a given period.',
    matter: 'Measured against the contracted minimum to see if the take-or-pay floor is being met.',
  },
  ytd: {
    term: 'YTD',
    expand: 'Year to Date',
    plain: 'The running total from the start of the year up to today.',
    matter: null,
  },
  mtd: {
    term: 'MTD',
    expand: 'Month to Date',
    plain: 'The running total from the start of the current month up to today.',
    matter: null,
  },
  pnl: {
    term: 'P&L',
    expand: 'Profit and Loss',
    plain: 'The statement of income earned against costs incurred over a period — what is left is the profit or loss.',
    matter: null,
  },
  cpi: {
    term: 'CPI',
    expand: 'Consumer Price Index',
    plain: 'The official measure of how much everyday prices have risen — the standard yardstick for inflation.',
    matter: 'Part of the haulage rate is indexed to it, so the price keeps pace with inflation.',
  },
  gss: {
    term: 'GSS',
    expand: 'Ghana Statistical Service',
    plain: 'The government body that publishes Ghana’s official economic figures, including the inflation index.',
    matter: null,
  },
};

/*
 * Normalise a raw term into a glossary slug, tolerant of spacing, case, and
 * hyphen/underscore variation. "Take Or Pay", "take_or_pay", "TAKE-OR-PAY"
 * all resolve to "take-or-pay".
 */
export function slugify(raw) {
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/* Look up an entry by term/slug. Returns the entry or null. */
export function termFor(raw) {
  if (!raw) return null;
  return GLOSSARY[slugify(raw)] || null;
}
