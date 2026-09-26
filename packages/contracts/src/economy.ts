import { z } from "zod";

// Server-authoritative economy contracts — Ledger v2.
//
// Invariants (canonical, from AGENTS.md and docs/economy_monetization_referrals.md §8):
//   - Coins, XP, Energy and Mastery Stars never change score, outcome, ranking,
//     or risk advantage. This file is the *only* place their shape is defined.
//   - The ledger is append-only. `idempotencyKey` is required on every event.
//   - Scenario completion grants XP + Mastery only, never Coins. Coins enter a
//     balance only via `coin_pack_credited` (Telegram Stars purchase) or
//     `coin_promo_granted` (server promo: referral, compensation, events).
//   - Promo Coins are separated from purchased Coins by the server-side `promo`
//     flag; only `coin_promo_granted` may carry `promo = true`.
//   - Energy is capped (0..5 default; the cap value is a domain concern, this
//     contract only pins the wire shape).
//
// Asset × kind matrix (a kind may only touch its declared asset):
//   xp_awarded          xp            amount > 0
//   mastery_awarded     mastery_star  amount > 0   (positive delta only)
//   energy_spent        energy        amount < 0
//   energy_regenerated  energy        amount > 0   (free, time-driven)
//   energy_refilled     energy        amount > 0   (paid / promo service)
//   coin_pack_credited  coin          amount > 0   (promo = false)
//   coin_promo_granted  coin          amount > 0   (promo = true; reason-gated)
//   coin_spent          coin          amount < 0

const IsoDate = z.string().datetime({ offset: true });

export const LedgerAssetSchema = z.enum(["xp", "energy", "coin", "mastery_star"]);

export const LedgerEventKindSchema = z.enum([
  "xp_awarded",
  "mastery_awarded",
  "energy_spent",
  "energy_regenerated",
  "energy_refilled",
  "coin_pack_credited",
  "coin_promo_granted",
  "coin_spent"
]);

export const RiskStateSchema = z.enum(["clear", "hold", "review", "granted", "rejected"]);

// Reasons that justify a promo Coin grant. `coin_promo_granted` must use one of
// these so a compensation grant is never mis-filed as a referral kind.
export const PromoReasonSchema = z.enum([
  "referral_activation",
  "referral_purchase",
  "compensation",
  "special_event",
  "tournament_promotion"
]);

export const KIND_ASSET: Readonly<Record<LedgerEventKind, LedgerAsset>> = {
  xp_awarded: "xp",
  mastery_awarded: "mastery_star",
  energy_spent: "energy",
  energy_regenerated: "energy",
  energy_refilled: "energy",
  coin_pack_credited: "coin",
  coin_promo_granted: "coin",
  coin_spent: "coin"
};

const POSITIVE_KINDS: ReadonlySet<LedgerEventKind> = new Set([
  "xp_awarded",
  "mastery_awarded",
  "energy_regenerated",
  "energy_refilled",
  "coin_pack_credited",
  "coin_promo_granted"
]);

const NEGATIVE_KINDS: ReadonlySet<LedgerEventKind> = new Set(["energy_spent", "coin_spent"]);

const LedgerEventShape = z.object({
  id: z.string().uuid(),
  userId: z.string().min(1),
  kind: LedgerEventKindSchema,
  asset: LedgerAssetSchema,
  amount: z.number().int(),
  reason: z.string().min(1),
  promo: z.boolean(),
  runId: z.string().min(1).nullable().optional(),
  sourceId: z.string().min(1).nullable().optional(),
  scenarioId: z.string().min(1).nullable().optional(),
  riskState: RiskStateSchema,
  idempotencyKey: z.string().min(1),
  createdAt: IsoDate
}).strict();

export const LedgerEventSchema = LedgerEventShape.superRefine((ev, ctx) => {
  if (KIND_ASSET[ev.kind] !== ev.asset) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["asset"],
      message: `kind '${ev.kind}' must use asset '${KIND_ASSET[ev.kind]}', got '${ev.asset}'`
    });
  }
  if (POSITIVE_KINDS.has(ev.kind) && ev.amount <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["amount"],
      message: `${ev.kind} requires a positive integer amount`
    });
  }
  if (NEGATIVE_KINDS.has(ev.kind) && ev.amount >= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["amount"],
      message: `${ev.kind} requires a negative integer amount`
    });
  }
  // Promo Coins are only ever minted by the promo grant kind.
  if (ev.promo && ev.kind !== "coin_promo_granted") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["promo"],
      message: `promo = true is only allowed for coin_promo_granted`
    });
  }
  if (ev.kind === "coin_promo_granted") {
    if (!ev.promo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["promo"],
        message: "coin_promo_granted must carry promo = true"
      });
    }
    if (!PromoReasonSchema.safeParse(ev.reason).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "coin_promo_granted requires a canonical promo reason"
      });
    }
  }
});

export const UserEconomyStateSchema = z.object({
  userId: z.string().min(1),
  xp: z.number().int().min(0),
  coins: z.number().int().min(0),
  promoCoins: z.number().int().min(0),
  masteryStars: z.number().int().min(0),
  energy: z.number().int().min(0).max(5),
  energyUpdatedAt: IsoDate,
  version: z.number().int().min(0)
}).strict();

export const BalanceResponseSchema = UserEconomyStateSchema;

export const LedgerPageSchema = z.object({
  events: z.array(LedgerEventSchema),
  nextCursor: z.string().min(1).nullable()
}).strict();

export type LedgerAsset = z.infer<typeof LedgerAssetSchema>;
export type LedgerEventKind = z.infer<typeof LedgerEventKindSchema>;
export type RiskState = z.infer<typeof RiskStateSchema>;
export type LedgerEvent = z.infer<typeof LedgerEventSchema>;
export type UserEconomyState = z.infer<typeof UserEconomyStateSchema>;
export type BalanceResponse = UserEconomyState;
export type LedgerPage = z.infer<typeof LedgerPageSchema>;
