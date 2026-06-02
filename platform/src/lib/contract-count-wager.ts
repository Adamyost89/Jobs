import { CONTRACT_SIGN_CHART_TIMEZONE } from "@/lib/contract-signed-month";

export const WAGER_TARGET = 232;
export const WAGER_WORK_YEAR = 2026;

export type WagerPrediction = {
  name: string;
  /** Calendar date in America/Chicago, YYYY-MM-DD */
  dateKey: string;
};

export const WAGER_PREDICTIONS: WagerPrediction[] = [
  { name: "Adam", dateKey: "2026-06-26" },
  { name: "Chris", dateKey: "2026-07-10" },
  { name: "Cale", dateKey: "2026-07-28" },
  { name: "Drew", dateKey: "2026-08-06" },
];

/** Timeline axis for the home card (Chicago calendar dates). */
export const WAGER_TIMELINE_START = "2026-06-01";
export const WAGER_TIMELINE_END = "2026-08-06";

export const WAGER_YTD_START = "2026-01-01";

export const WAGER_PRIZE_COPY =
  "Winner gets: one (1) gas station hot dog, billed to the company card.";

export type WagerPersonStatus =
  | "in_running"
  | "needs_miracle"
  | "called_it"
  | "close_but_late";

export type WagerPersonRow = WagerPrediction & {
  status: WagerPersonStatus;
  statusLabel: string;
};

export type WagerOddsRow = {
  name: string;
  probability: number;
  quip: string;
};

export type WagerSnapshot = {
  current: number;
  target: number;
  reachedTarget: boolean;
  todayKey: string;
  rows: WagerPersonRow[];
  winner: WagerPrediction | null;
  projectedHitDateKey: string | null;
  odds: WagerOddsRow[];
};

const STATUS_LABELS: Record<WagerPersonStatus, string> = {
  in_running: "In the running",
  needs_miracle: "Needs a miracle",
  called_it: "Called it",
  close_but_late: "Close but late",
};

/** Chicago calendar date as YYYY-MM-DD (en-CA locale). */
export function chicagoDateKey(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: CONTRACT_SIGN_CHART_TIMEZONE });
}

function parseDateKey(key: string): Date {
  return new Date(`${key}T12:00:00.000Z`);
}

/** Inclusive calendar-day count from `startKey` through `endKey`. */
export function calendarDaysInclusive(startKey: string, endKey: string): number {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  const diff = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return diff + 1;
}

export function addCalendarDays(dateKey: string, days: number): string {
  const d = parseDateKey(dateKey);
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

/** 0–1 position on the Jun 1 – Aug 6 wager timeline; clamped. */
export function timelinePosition(dateKey: string): number {
  const start = parseDateKey(WAGER_TIMELINE_START).getTime();
  const end = parseDateKey(WAGER_TIMELINE_END).getTime();
  const t = parseDateKey(dateKey).getTime();
  if (end <= start) return 0;
  const raw = (t - start) / (end - start);
  return Math.min(1, Math.max(0, raw));
}

export function formatWagerDate(dateKey: string): string {
  const d = parseDateKey(dateKey);
  return d.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function personStatus(
  predictionKey: string,
  todayKey: string,
  hitDateKey: string | null
): WagerPersonStatus {
  if (hitDateKey) {
    return predictionKey >= hitDateKey ? "called_it" : "close_but_late";
  }
  return todayKey <= predictionKey ? "in_running" : "needs_miracle";
}

function calendarDaysApart(a: string, b: string): number {
  const da = parseDateKey(a);
  const db = parseDateKey(b);
  return Math.abs(Math.round((db.getTime() - da.getTime()) / 86_400_000));
}

/** Closest prediction to the actual hit date (minimum absolute day difference). */
export function wagerWinner(
  predictions: WagerPrediction[],
  hitDateKey: string
): WagerPrediction | null {
  if (predictions.length === 0) return null;
  let best = predictions[0];
  let bestDiff = calendarDaysApart(predictions[0].dateKey, hitDateKey);
  for (let i = 1; i < predictions.length; i++) {
    const p = predictions[i];
    const diff = calendarDaysApart(p.dateKey, hitDateKey);
    if (diff < bestDiff) {
      best = p;
      bestDiff = diff;
    }
  }
  return best;
}

/** YTD pace from Jan 1 through `todayKey`; null if no pace or already at target. */
export function projectedHitDate(
  current: number,
  todayKey: string,
  target: number = WAGER_TARGET
): string | null {
  if (current >= target) return null;
  const daysElapsed = calendarDaysInclusive(WAGER_YTD_START, todayKey);
  if (daysElapsed <= 0 || current <= 0) return null;
  const pace = current / daysElapsed;
  const remaining = target - current;
  const daysToGo = remaining / pace;
  if (!Number.isFinite(daysToGo) || daysToGo <= 0) return null;
  return addCalendarDays(todayKey, daysToGo);
}

export function wagerSnapshot(
  current: number,
  today: Date = new Date(),
  target: number = WAGER_TARGET
): WagerSnapshot {
  const todayKey = chicagoDateKey(today);
  const reachedTarget = current >= target;
  const hitDateKey = reachedTarget ? todayKey : null;

  const rows: WagerPersonRow[] = WAGER_PREDICTIONS.map((p) => {
    const status = personStatus(p.dateKey, todayKey, hitDateKey);
    return { ...p, status, statusLabel: STATUS_LABELS[status] };
  });

  const winner = hitDateKey ? wagerWinner(WAGER_PREDICTIONS, hitDateKey) : null;
  const projectedHitDateKey = projectedHitDate(current, todayKey, target);
  const odds = wagerOdds(rows, reachedTarget ? todayKey : projectedHitDateKey ?? todayKey);

  return {
    current,
    target,
    reachedTarget,
    todayKey,
    rows,
    winner,
    projectedHitDateKey,
    odds,
  };
}

function probabilityQuip(probability: number): string {
  if (probability >= 65) return "Sure, go ahead and pre-order the victory selfie.";
  if (probability >= 40) return "Looking decent, which is suspicious.";
  if (probability >= 20) return "Math says maybe. The hot dog says lol.";
  if (probability >= 10) return "Not impossible, just deeply inconvenient.";
  return "Technically alive, spiritually eliminated.";
}

/**
 * Probability model based on how close each pick is to the estimated hit date.
 * Uses an exponential decay so nearby picks get most of the odds.
 */
export function wagerOdds(rows: WagerPersonRow[], expectedHitDateKey: string): WagerOddsRow[] {
  if (rows.length === 0) return [];
  const SCALE_DAYS = 7;
  const weights = rows.map((row) => {
    const diff = calendarDaysApart(row.dateKey, expectedHitDateKey);
    return Math.exp(-diff / SCALE_DAYS);
  });
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight <= 0) {
    const equal = 100 / rows.length;
    return rows.map((row) => ({
      name: row.name,
      probability: equal,
      quip: probabilityQuip(equal),
    }));
  }

  const raw = rows.map((row, idx) => ({
    name: row.name,
    probability: (weights[idx]! / totalWeight) * 100,
  }));
  const rounded = raw.map((r) => ({ ...r, probability: Math.round(r.probability * 10) / 10 }));
  const roundedTotal = rounded.reduce((sum, r) => sum + r.probability, 0);
  const drift = Math.round((100 - roundedTotal) * 10) / 10;
  if (Math.abs(drift) > 0 && rounded.length > 0) {
    let maxIdx = 0;
    for (let i = 1; i < rounded.length; i++) {
      if (rounded[i]!.probability > rounded[maxIdx]!.probability) maxIdx = i;
    }
    rounded[maxIdx]!.probability = Math.max(0, Math.round((rounded[maxIdx]!.probability + drift) * 10) / 10);
  }

  return rounded.map((r) => ({
    ...r,
    quip: probabilityQuip(r.probability),
  }));
}

function pickStable(pool: string[], seed: string): string {
  if (pool.length === 0) return "";
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return pool[Math.abs(h) % pool.length]!;
}

/** Soonest upcoming pick among people still in the running. */
export function calendarLeader(rows: WagerPersonRow[]): WagerPersonRow | null {
  const running = rows.filter((r) => r.status === "in_running");
  if (running.length === 0) return null;
  return running.reduce((a, b) => (a.dateKey <= b.dateKey ? a : b));
}

/** Who missed first — earliest pick date among needs_miracle. */
export function firstNeedsMiracle(rows: WagerPersonRow[]): WagerPersonRow | null {
  const miracles = rows.filter((r) => r.status === "needs_miracle");
  if (miracles.length === 0) return null;
  return miracles.reduce((a, b) => (a.dateKey <= b.dateKey ? a : b));
}

const MIRACLE_ROW_QUIPS = [
  "The roller weeps.",
  "Asked for a sign. Got a calendar.",
  "Hot dog status: still theoretical.",
  "Bold strategy. Let's see if it pays off.",
  "Miracle pending. Hot dog on hold.",
];

const LATE_ROW_QUIPS = [
  "So close you can smell the roller.",
  "The hot dog remembers.",
  "Calendar said no. Condiments cried.",
];

/** Small quip under a row when they're in trouble or just missed. */
export function wagerPersonQuip(row: WagerPersonRow, todayKey: string): string | null {
  if (row.status === "needs_miracle") {
    return pickStable(MIRACLE_ROW_QUIPS, `${todayKey}|miracle|${row.name}`);
  }
  if (row.status === "close_but_late") {
    return pickStable(LATE_ROW_QUIPS, `${todayKey}|late|${row.name}`);
  }
  return null;
}

/** One rotating banter line for the card header area. */
export function wagerBanterLine(snap: WagerSnapshot): string {
  const { rows, todayKey, projectedHitDateKey: pace, reachedTarget, winner } = snap;

  if (reachedTarget && winner) {
    return pickStable(
      [
        `The hot dog has left the roller. ${winner.name}, please collect.`,
        `${winner.name} wins the hot dog. Receipt required. Condiments negotiable.`,
        `232 achieved. ${winner.name} owns the roller now. Everyone else: nod respectfully.`,
      ],
      `${todayKey}|won|${winner.name}`
    );
  }

  const running = rows.filter((r) => r.status === "in_running");
  const miracles = rows.filter((r) => r.status === "needs_miracle");
  const leader = calendarLeader(rows);
  const firstMiss = firstNeedsMiracle(rows);
  const earliestPick = WAGER_PREDICTIONS[0]!.dateKey;

  if (running.length === rows.length && leader) {
    return pickStable(
      [
        `${leader.name}'s on the clock first. No pressure — the hot dog's already sweating in the roller.`,
        `Everyone's still in it. ${leader.name} goes first. The roller is watching.`,
        `${leader.name} picked the soonest date. Courageous. The hot dog believes in you.`,
      ],
      `${todayKey}|all-running|${leader.name}`
    );
  }

  if (running.length === 1 && running[0]!.name === "Drew") {
    return pickStable(
      [
        "Drew picked August 6. Bold. The roller has seen things.",
        "Only Drew's date is still standing. The hot dog is patient. Drew is not.",
        "Three admins missed. Drew's still in. This is a movie.",
      ],
      `${todayKey}|drew-alone`
    );
  }

  if (miracles.length >= 2 && firstMiss && leader) {
    return pickStable(
      [
        `${firstMiss.name} needs a miracle. ${leader.name} still thinks this is fine.`,
        `${miracles.length} admins need divine intervention. ${leader.name} is up next. Pray for sales.`,
        `The hot dog remains unclaimed. ${firstMiss.name} was wrong first. ${leader.name}, you're on deck.`,
      ],
      `${todayKey}|multi|${firstMiss.name}|${leader.name}`
    );
  }

  if (pace && firstMiss) {
    return pickStable(
      [
        `YTD says we're late. ${firstMiss.name} would like a word with the sales team.`,
        `Pace says ${formatWagerDate(pace)}. ${firstMiss.name} already knows they were early. Wrong early.`,
        `The forecast is grim. ${firstMiss.name} felt it first.`,
      ],
      `${todayKey}|pace-late|${firstMiss.name}`
    );
  }

  if (firstMiss && leader) {
    return pickStable(
      [
        `${firstMiss.name}'s date came and went. The hot dog remains unclaimed.`,
        `${firstMiss.name} needs a miracle. ${leader.name} is up next — don't choke.`,
        `${firstMiss.name} whiffed. ${leader.name} has the next swing. Roller's watching.`,
      ],
      `${todayKey}|miss+lead|${firstMiss.name}`
    );
  }

  if (firstMiss) {
    return pickStable(
      [
        `${firstMiss.name}'s pick aged like gas-station coffee. Science is disappointed.`,
        `${firstMiss.name}'s date passed. The hot dog sends its regards.`,
        `${firstMiss.name} asked for a miracle. HR said check the sales pipeline.`,
      ],
      `${todayKey}|miss|${firstMiss.name}`
    );
  }

  if (pace && pace < earliestPick) {
    return pickStable(
      [
        "At this pace we'll hit 232 before anyone's guess. The hot dog may expire from relevance.",
        "YTD is cooking. Every pick date might be too late. Chaos wins.",
        "The numbers don't care about your calendar. The roller is nervous.",
      ],
      `${todayKey}|pace-early`
    );
  }

  if (pace && leader && pace > leader.dateKey) {
    return pickStable(
      [
        `YTD says ${formatWagerDate(pace)}. ${leader.name} picked ${formatWagerDate(leader.dateKey)}. Someone's buying two hot dogs.`,
        `Pace points past ${leader.name}'s date. Awkward for everyone with a sooner pick.`,
        `We're trending late. ${leader.name} might need that miracle sooner than planned.`,
      ],
      `${todayKey}|pace-slow|${leader.name}`
    );
  }

  if (leader) {
    return pickStable(
      [
        `${leader.name} is up next. Everyone else is pretending they're fine.`,
        `${leader.name}'s date is the next boss fight. Hot dog on the line.`,
        `All eyes on ${leader.name}. The roller never blinks.`,
      ],
      `${todayKey}|lead|${leader.name}`
    );
  }

  const remaining = Math.max(0, snap.target - snap.current);
  return pickStable(
    [
      `${remaining} contracts stand between us and glory. And one hot dog.`,
      "The admin pool is heating up. The hot dog is room temperature. Perfect.",
      "232 or bust. Losers still show up to Monday meeting.",
    ],
    `${todayKey}|fallback`
  );
}

/** Green victory line when target is hit. */
export function wagerVictoryMessage(snap: WagerSnapshot): string | null {
  if (!snap.reachedTarget || !snap.winner) return null;
  const late = snap.rows.filter((r) => r.status === "close_but_late");
  const lateNames = late.map((r) => r.name).join(", ");
  const hit = formatWagerDate(snap.todayKey);

  if (late.length > 0) {
    return pickStable(
      [
        `${snap.winner.name} called it on ${hit} — closest to the hot dog. ${lateNames} were close but late. Redeem at any participating roller.`,
        `${snap.winner.name} takes the gas-station hot dog. ${lateNames}: honorable mentions, no buns.`,
      ],
      `${snap.todayKey}|victory-late|${snap.winner.name}`
    );
  }

  return pickStable(
    [
      `${snap.winner.name} wins on ${hit}. One (1) hot dog, company card, no questions asked.`,
      `${snap.winner.name} takes it — closest call to ${snap.target}. The roller salutes you.`,
    ],
    `${snap.todayKey}|victory|${snap.winner.name}`
  );
}
