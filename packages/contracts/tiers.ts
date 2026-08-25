export const TIER_PRICING = {
  tier_1: 5000,
  tier_2: 10000,
  // Range 25000–50000; price_usd is required when an offer is made.
  tier_3: null,
  tier_4: 100000,
} as const;

export const TIER_3_PRICE_RANGE = {
  min: 25000,
  max: 50000,
} as const;

export type IncubatorTier = keyof typeof TIER_PRICING;

export type TierPriceUsd = (typeof TIER_PRICING)[IncubatorTier];

export function defaultPriceUsdForTier(tier: IncubatorTier): number | null {
  return TIER_PRICING[tier];
}
