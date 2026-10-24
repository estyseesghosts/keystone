// Recommendations feed domain models (fork feature, dvd-sharkey).
//
// Pure TS: no framework imports, no globals (enforced by `no-ui-in-fedi`).
// Ported from `utility/recommendation-reason.ts` + settings page +
// `rec-settings` backend shape — own code, same contracts. Wire field
// names (`_recommendationFactors_`) never cross into `src/`; the adapter
// moves them into `Post.ext.recommendation`.

import type { Cursor } from "./models";

/** Factor keys, in sync with backend `RecFactorKey`. */
export type RecFactorKey =
  | "relevancy"
  | "authorAffinity"
  | "quality"
  | "popularity"
  | "recency"
  | "shortPostPenalty"
  | "overTagPenalty"
  | "replyPenalty"
  | "topicPreference"
  | "followed"
  | "similarUsers";

export const REC_FACTOR_KEYS: readonly RecFactorKey[] = [
  "relevancy",
  "authorAffinity",
  "quality",
  "popularity",
  "recency",
  "shortPostPenalty",
  "overTagPenalty",
  "replyPenalty",
  "topicPreference",
  "followed",
  "similarUsers",
];

/** Engagement keys for the interest-vector update weights. */
export type RecEngagementKey = "reaction" | "reply" | "boost" | "favorite" | "post";

export const REC_ENGAGEMENT_KEYS: readonly RecEngagementKey[] = [
  "reaction",
  "reply",
  "boost",
  "favorite",
  "post",
];

/** One row of the "why was this recommended?" breakdown table. */
export interface RecommendationBreakdownRow {
  key: RecFactorKey;
  kind: "add" | "mult";
  raw: number;
  weight: number;
  coeff: number;
  effect: number;
}

export interface RecommendationEngagementRow {
  key: string;
  prob: number;
  value: number;
  effect: number;
}

export interface RecommendationBreakdown {
  type: "following" | "score";
  score: number;
  subtotal: number;
  topic: string | null;
  rows: RecommendationBreakdownRow[];
  mode?: "hand" | "learned" | "blend";
  learnedScore?: number;
  rankerWeight?: number;
  engagements?: RecommendationEngagementRow[];
}

/** Full recommendation settings (`me.recommendationSettings`, `i/update`). */
export interface RecommendationSettings {
  enabled: boolean;
  recommendNsfw: boolean;
  factors: Record<RecFactorKey, number>;
  engagement: Record<RecEngagementKey, number>;
  interestTopics: string[];
  disinterestTopics: string[];
  languages: string[];
  followedRatio: number;
}

/** Fixed topic taxonomy (mirrors backend `rec-topics`). */
export const REC_TOPIC_SLUGS: readonly string[] = [
  "anime",
  "gaming",
  "art",
  "sports",
  "drawing",
  "humor",
  "tech",
  "home",
  "food",
  "photography",
  "science",
  "study",
  "travel",
  "music",
  "culture",
  "emotion",
  "career",
  "social-science",
  "literature",
  "news",
  "programming",
  "politics",
  "pets",
  "daily-life",
];

/** Languages the recommender has data for (mirror backend `REC_LANGUAGES`). */
export const REC_LANGUAGES: readonly string[] = ["en", "ja", "zh"];

export function isRecFactorKey(value: unknown): value is RecFactorKey {
  return (
    typeof value === "string" && (REC_FACTOR_KEYS as readonly string[]).includes(value)
  );
}

export function isRecTopicSlug(value: unknown): value is string {
  return typeof value === "string" && (REC_TOPIC_SLUGS as readonly string[]).includes(value);
}

export function isRecLanguage(value: unknown): value is string {
  return typeof value === "string" && (REC_LANGUAGES as readonly string[]).includes(value);
}

/** Default recommendation language from a UI locale (`ja*` → ja, `zh*`/`yue*` → zh, else en). Pure. */
export function defaultRecLanguage(locale: string | null | undefined): string {
  const raw = (locale ?? "").toLowerCase();
  if (raw.startsWith("ja")) return "ja";
  if (raw.startsWith("zh") || raw.startsWith("yue")) return "zh";
  return "en";
}

/** Map an app locale to the recommender `lang` param. Pure. */
export function recLangForLocale(locale: string | null | undefined): string {
  return defaultRecLanguage(locale);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Read `recommendationSettings` off an adapted `me` account's `ext.me` bag. Null when absent. */
export function recommendationSettingsOf(me: { ext?: { me?: unknown } } | null | undefined): RecommendationSettings | null {
  const bag = asRecord(me?.ext?.me);
  const raw = bag ? asRecord(bag["recommendationSettings"]) : null;
  if (!raw) return null;
  return {
    enabled: raw["enabled"] !== false,
    recommendNsfw: raw["recommendNsfw"] === true,
    factors: normalizeFactors(raw["factors"]),
    engagement: normalizeEngagement(raw["engagement"]),
    interestTopics: stringList(raw["interestTopics"]),
    disinterestTopics: stringList(raw["disinterestTopics"]),
    languages: stringList(raw["languages"]).filter(isRecLanguage),
    followedRatio: typeof raw["followedRatio"] === "number" ? raw["followedRatio"] : 0.3,
  };
}

/** Gating rule: default `true` when the field is missing (`!== false`), so old accounts keep the feed. */
export function recommendationsEnabled(
  me: { ext?: { me?: unknown } } | null | undefined,
): boolean {
  const bag = asRecord(me?.ext?.me);
  const raw = bag ? asRecord(bag["recommendationSettings"]) : null;
  if (!raw) return true;
  return raw["enabled"] !== false;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeFactors(raw: unknown): Record<RecFactorKey, number> {
  const rec = asRecord(raw) ?? {};
  const out = {} as Record<RecFactorKey, number>;
  for (const key of REC_FACTOR_KEYS) out[key] = num(rec[key], 1);
  return out;
}

function normalizeEngagement(raw: unknown): Record<RecEngagementKey, number> {
  const rec = asRecord(raw) ?? {};
  const out = {} as Record<RecEngagementKey, number>;
  for (const key of REC_ENGAGEMENT_KEYS) out[key] = num(rec[key], 1);
  return out;
}

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

/** Default settings for a fresh form (before `me` loads): all coefficients 1, ratio 0.3, lang from locale. */
export function defaultRecommendationSettings(locale: string | null | undefined): RecommendationSettings {
  const factors = {} as Record<RecFactorKey, number>;
  for (const key of REC_FACTOR_KEYS) factors[key] = 1;
  const engagement = {} as Record<RecEngagementKey, number>;
  for (const key of REC_ENGAGEMENT_KEYS) engagement[key] = 1;
  return {
    enabled: true,
    recommendNsfw: false,
    factors,
    engagement,
    interestTopics: [],
    disinterestTopics: [],
    languages: [defaultRecLanguage(locale)],
    followedRatio: 0.3,
  };
}

// --- Offset cursor (the recommendations queue pages by offset, not id) ---

/** Encode the next offset as an opaque cursor. The UI treats it as a token. */
export function encodeRecCursor(offset: number): Cursor {
  return `rec:${Math.max(0, Math.floor(offset))}` as Cursor;
}

/** Decode an offset cursor back to its offset. Unknown shapes read as 0. Pure. */
export function decodeRecCursor(cursor: Cursor | null | undefined): number {
  if (typeof cursor !== "string") return 0;
  const m = /^rec:(\d+)$/.exec(cursor);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}
