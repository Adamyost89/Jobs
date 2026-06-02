import type { PrismaClient } from "@prisma/client";
import {
  WAGER_WORK_YEAR,
  chicagoDateKey,
  wagerSnapshot,
  type WagerSnapshot,
} from "@/lib/contract-count-wager";
import {
  loadWagerSeasonalBasis,
  loadYtdCompanyMetrics,
  type WagerYtdMetrics,
} from "@/lib/contract-count-seasonal-data";

export type WagerCardPayload = {
  workYear: number;
  ytd: WagerYtdMetrics;
  seasonal: Awaited<ReturnType<typeof loadWagerSeasonalBasis>>;
  snapshot: WagerSnapshot;
};

/** Live wager card data — YTD through Chicago today, seasonal basis from prior years. */
export async function loadWagerCardPayload(db: PrismaClient): Promise<WagerCardPayload | null> {
  const todayKey = chicagoDateKey();
  const [seasonal, ytd] = await Promise.all([
    loadWagerSeasonalBasis(db),
    loadYtdCompanyMetrics(db, WAGER_WORK_YEAR, todayKey),
  ]);

  const snapshot = wagerSnapshot(ytd.count, undefined, undefined, seasonal, ytd);

  return {
    workYear: WAGER_WORK_YEAR,
    ytd,
    seasonal,
    snapshot,
  };
}
