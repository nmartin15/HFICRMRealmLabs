import { z } from "zod";
import {
  operatorWarmthLevelSchema,
  personSignalKindSchema,
  programInterestSchema,
  type PersonSignalKind,
  type PersonSignalSource,
} from "./enums";

export const EXTRACTOR_ID = "rules.2026-09-12.v1";

export const signalCapitalKindSchema = z.enum([
  "program_fee",
  "aum",
  "unknown",
]);
export type SignalCapitalKind = z.infer<typeof signalCapitalKindSchema>;

export const signalTimelineUrgencySchema = z.enum([
  "now",
  "this_quarter",
  "later",
]);
export type SignalTimelineUrgency = z.infer<typeof signalTimelineUrgencySchema>;

export const aumOrBudgetSignalValueSchema = z.object({
  amountUsd: z.number().int().nonnegative().nullable(),
  amountRaw: z.string().min(1),
  capitalKind: signalCapitalKindSchema,
});
export type AumOrBudgetSignalValue = z.infer<
  typeof aumOrBudgetSignalValueSchema
>;

export const decisionTimelineSignalValueSchema = z.object({
  urgency: signalTimelineUrgencySchema,
});
export type DecisionTimelineSignalValue = z.infer<
  typeof decisionTimelineSignalValueSchema
>;

export const programFitSignalValueSchema = z.object({
  fit: z.enum(["yes", "no"]),
  program: programInterestSchema.or(z.literal("unknown")),
});
export type ProgramFitSignalValue = z.infer<
  typeof programFitSignalValueSchema
>;

export const objectionSignalValueSchema = z.object({
  topic: z.enum(["price", "timing", "partner", "other"]),
  disqualifier: z.boolean(),
});
export type ObjectionSignalValue = z.infer<typeof objectionSignalValueSchema>;

export const warmthSignalValueSchema = z.object({
  level: operatorWarmthLevelSchema,
  at: z.number().int(),
  setBy: z
    .object({
      id: z.string().uuid(),
      email: z.string().email(),
      name: z.string().min(1),
    })
    .optional(),
});
export type WarmthSignalValue = z.infer<typeof warmthSignalValueSchema>;

export const extractedSignalSchema = z.object({
  kind: personSignalKindSchema,
  value: z.record(z.string(), z.unknown()),
  excerpt: z.string().min(1),
});
export type ExtractedSignal = z.infer<typeof extractedSignalSchema>;

export const extractDocumentResultSchema = z.object({
  extractor: z.literal(EXTRACTOR_ID),
  findings: z.array(extractedSignalSchema),
  optOut: z.object({ excerpt: z.string().min(1) }).nullable(),
});
export type ExtractDocumentResult = z.infer<
  typeof extractDocumentResultSchema
>;

export const extractedScoreFactsSchema = z.object({
  statedProgramFee: z.boolean(),
  explicitProgramFit: z.enum(["yes", "no", "unknown"]),
  timeline: z.enum(["now", "this_quarter", "later", "unknown"]),
});
export type ExtractedScoreFacts = z.infer<typeof extractedScoreFactsSchema>;

export const EMPTY_EXTRACTED_SCORE_FACTS: ExtractedScoreFacts = {
  statedProgramFee: false,
  explicitProgramFit: "unknown",
  timeline: "unknown",
};

const EXCERPT_MAX = 180;

const OPT_OUT_RE = [
  /\btake\s+(me|them|him|her|us)\s+off\s+(of\s+)?(your\s+|the\s+)?(mailing\s+|email\s+)?list\b/i,
  /\bremove\s+(me|them|him|her|us)\s+from\s+(your\s+|the\s+)?(mailing\s+|email\s+)?list\b/i,
  /\b(please\s+)?unsubscribe\b/i,
  /\bstop\s+emailing\s+(me|us)\b/i,
  /\bstop\s+sending\s+(me\s+|us\s+)?(emails?|these)\b/i,
  /\bdo\s+not\s+(email|contact)\s+(me|us)\b/i,
  /\bdon'?t\s+(email|contact)\s+(me|us)\b/i,
  /\bopt[-\s]?out\b/i,
  /\bno\s+more\s+emails?\b/i,
  /\b(wants?|asked|asked\s+to\s+be)\s+(unsubscribed|off\s+the\s+list)\b/i,
];

const WAITLIST_RE = /\bwaitlist\b/i;

const AUM_RE =
  /\b(aum|under\s+management|assets\s+under|fund\s+size|book\s+size|i\s+manage|we\s+manage|managing)\b/i;
const PROGRAM_FEE_RE =
  /\b(program\s+fee|tuition|incubator\s+fee|i\s+can\s+pay|we\s+can\s+pay|i'?ll\s+pay|i\s+have\s+.+\b(personally|personally\s+available)|personal\s+(capital|budget|check)|budget\s+for\s+(the\s+)?(program|incubator|fee)|afford\s+the\s+(program|fee|incubator))\b/i;
const FIRST_PERSON_PAY_RE =
  /\b(i|we)\s+(can|could|will|have)\s+.{0,40}\b(\$[\d,]+|\d[\d,]*\s*(k|m)\b)/i;

const MONEY_RE =
  /\$?\s*([\d,]+(?:\.\d+)?)\s*(k|m|mm|million|billion|bn)?\b/gi;

const ENTHUSIASM_RE =
  /\b(excited|exciting|sounds\s+great|love\s+this|looking\s+forward|can'?t\s+wait|huge\s+opportunity|this\s+could\s+be\s+huge)\b/i;

const SCHEDULING_RE =
  /\b(available|calendar|zoom|google\s+meet|reschedule|does\s+this\s+time\s+work|talk\s+then|see\s+you|works\s+for\s+me|let'?s\s+speak|lets\s+speak|booked|invite\s+attached|what\s+time\s+works|thursday\s+at|tuesday\s+at|am\s+slot|pm\s+slot)\b/i;

const TIMELINE_NOW_RE =
  /\b(this\s+week|immediately|as\s+soon\s+as|ready\s+to\s+(start|begin|enroll|join)|right\s+away)\b/i;
const TIMELINE_QUARTER_RE =
  /\b(this\s+month|this\s+quarter|next\s+month|q[1-4])\b/i;
const TIMELINE_LATER_RE =
  /\b(next\s+year|not\s+until|sometime\s+next)\b/i;
const TIMELINE_CONTEXT_RE =
  /\b(start|begin|enroll|join|timeline|decision|move\s+forward|kick\s+off|onboard)\b/i;

const FIT_YES_RE =
  /\b(interested\s+in\s+(the\s+)?(incubator|lp|placement|program)|want\s+to\s+apply|ready\s+to\s+apply)\b/i;
const FIT_NO_RE =
  /\b(not\s+(a\s+)?fit|not\s+interested|don'?t\s+want\s+(the\s+)?(program|incubator)|pass\s+on\s+this)\b/i;

const INCUBATOR_RE = /\b(incubator|hedge\s+fund\s+incubator)\b/i;
const LP_RE = /\b(lp\s+raising|capital\s+raising|raising\s+program)\b/i;
const PLACEMENT_RE = /\b(placement|quant\s+analyst)\b/i;

const OBJECTION_PRICE_RE =
  /\b(too\s+expensive|can'?t\s+afford\s+(the\s+)?(fee|program|incubator)|price\s+is\s+(too\s+)?high)\b/i;
const OBJECTION_TIMING_RE =
  /\b(timing\s+(isn'?t|is\s+not)\s+right|not\s+the\s+right\s+time)\b/i;
const OBJECTION_PARTNER_RE =
  /\b(talk\s+to\s+(my\s+|our\s+)?(wife|husband|partner|spouse|co-?founder))\b/i;

export function contactVisibleText(text: string): string {
  const withoutOriginal = text.split(/-----Original Message-----/i)[0] ?? text;
  const withoutWrote = withoutOriginal.split(
    /\nOn\s+\w.+\bwrote:\s*$/m,
  )[0] ?? withoutOriginal;
  const lines: string[] = [];
  for (const line of withoutWrote.split(/\r?\n/)) {
    if (/^\s*>/.test(line)) {
      continue;
    }
    if (lines.length > 0 && /^From:\s+/i.test(line)) {
      break;
    }
    lines.push(line);
  }
  return lines.join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n").trim();
}

function excerptAround(text: string, match: string): string {
  const index = text.toLowerCase().indexOf(match.toLowerCase());
  if (index < 0) {
    return text.replace(/\s+/g, " ").trim().slice(0, EXCERPT_MAX);
  }
  const start = Math.max(0, index - 40);
  const slice = text.slice(start, index + match.length + 80).replace(/\s+/g, " ").trim();
  return slice.slice(0, EXCERPT_MAX);
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseUsd(rawAmount: string, unit: string | undefined): number | null {
  const n = Number.parseFloat(rawAmount.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  const suffix = (unit ?? "").toLowerCase();
  if (suffix === "k") {
    return Math.round(n * 1_000);
  }
  if (suffix === "m" || suffix === "mm" || suffix === "million") {
    return Math.round(n * 1_000_000);
  }
  if (suffix === "billion" || suffix === "bn") {
    return Math.round(n * 1_000_000_000);
  }
  return Math.round(n);
}

function firstMoney(sentence: string): { amountUsd: number; amountRaw: string } | null {
  MONEY_RE.lastIndex = 0;
  const match = MONEY_RE.exec(sentence);
  if (!match || match[1] === undefined) {
    return null;
  }
  const amountUsd = parseUsd(match[1], match[2]);
  if (amountUsd === null) {
    return null;
  }
  return { amountUsd, amountRaw: match[0].trim() };
}

function programFor(text: string): ProgramFitSignalValue["program"] {
  if (INCUBATOR_RE.test(text)) {
    return "hedge_fund_incubator";
  }
  if (LP_RE.test(text)) {
    return "lp_raising_program";
  }
  if (PLACEMENT_RE.test(text)) {
    return "quant_analyst_placement";
  }
  return "unknown";
}

function classifyCapital(sentence: string): SignalCapitalKind {
  const aum = AUM_RE.test(sentence);
  const fee =
    PROGRAM_FEE_RE.test(sentence) || FIRST_PERSON_PAY_RE.test(sentence);
  if (aum && fee) {
    return "aum";
  }
  if (aum) {
    return "aum";
  }
  if (fee) {
    return "program_fee";
  }
  return "unknown";
}

function isSchedulingNoise(text: string): boolean {
  if (text.length > 280) {
    return false;
  }
  if (!SCHEDULING_RE.test(text)) {
    return false;
  }
  return !firstMoney(text) && !FIT_YES_RE.test(text) && !FIT_NO_RE.test(text);
}

function findOptOut(text: string): { excerpt: string } | null {
  if (WAITLIST_RE.test(text) && !/\bmailing\s+list\b/i.test(text)) {
    const waitlistOnly = OPT_OUT_RE.every((re) => {
      const match = text.match(re);
      if (!match?.[0]) {
        return true;
      }
      const window = excerptAround(text, match[0]);
      return WAITLIST_RE.test(window) && !/\bmailing\s+list\b/i.test(window);
    });
    if (waitlistOnly) {
      return null;
    }
  }
  for (const re of OPT_OUT_RE) {
    const match = text.match(re);
    if (match?.[0] && !WAITLIST_RE.test(excerptAround(text, match[0]))) {
      return { excerpt: excerptAround(text, match[0]) };
    }
  }
  return null;
}

export function extractDocument(input: { text: string }): ExtractDocumentResult {
  const visible = contactVisibleText(input.text);
  if (visible.length < 8) {
    return { extractor: EXTRACTOR_ID, findings: [], optOut: null };
  }

  const optOut = findOptOut(visible);
  if (isSchedulingNoise(visible) && !optOut) {
    return { extractor: EXTRACTOR_ID, findings: [], optOut: null };
  }

  const findings: ExtractedSignal[] = [];
  const seen = new Set<string>();

  const push = (kind: PersonSignalKind, value: Record<string, unknown>, excerpt: string) => {
    const key = `${kind}:${JSON.stringify(value)}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    findings.push({ kind, value, excerpt });
  };

  for (const sentence of sentences(visible)) {
    if (ENTHUSIASM_RE.test(sentence) && !firstMoney(sentence) && !FIT_YES_RE.test(sentence)) {
      continue;
    }

    const money = firstMoney(sentence);
    if (money) {
      const capitalKind = classifyCapital(sentence);
      const value = aumOrBudgetSignalValueSchema.parse({
        amountUsd: money.amountUsd,
        amountRaw: money.amountRaw,
        capitalKind,
      });
      push("aum_or_budget", value, excerptAround(sentence, money.amountRaw));
    }

    if (TIMELINE_CONTEXT_RE.test(sentence)) {
      if (TIMELINE_NOW_RE.test(sentence)) {
        push(
          "decision_timeline",
          decisionTimelineSignalValueSchema.parse({ urgency: "now" }),
          excerptAround(sentence, sentence.slice(0, 40)),
        );
      } else if (TIMELINE_QUARTER_RE.test(sentence)) {
        push(
          "decision_timeline",
          decisionTimelineSignalValueSchema.parse({ urgency: "this_quarter" }),
          excerptAround(sentence, sentence.slice(0, 40)),
        );
      } else if (TIMELINE_LATER_RE.test(sentence)) {
        push(
          "decision_timeline",
          decisionTimelineSignalValueSchema.parse({ urgency: "later" }),
          excerptAround(sentence, sentence.slice(0, 40)),
        );
      }
    }

    if (FIT_YES_RE.test(sentence)) {
      push(
        "program_fit",
        programFitSignalValueSchema.parse({
          fit: "yes",
          program: programFor(sentence),
        }),
        excerptAround(sentence, sentence.slice(0, 40)),
      );
    } else if (FIT_NO_RE.test(sentence)) {
      push(
        "program_fit",
        programFitSignalValueSchema.parse({
          fit: "no",
          program: programFor(sentence),
        }),
        excerptAround(sentence, sentence.slice(0, 40)),
      );
    }

    if (OBJECTION_PRICE_RE.test(sentence)) {
      push(
        "objection",
        objectionSignalValueSchema.parse({ topic: "price", disqualifier: false }),
        excerptAround(sentence, sentence.slice(0, 40)),
      );
    } else if (OBJECTION_TIMING_RE.test(sentence)) {
      push(
        "objection",
        objectionSignalValueSchema.parse({ topic: "timing", disqualifier: false }),
        excerptAround(sentence, sentence.slice(0, 40)),
      );
    } else if (OBJECTION_PARTNER_RE.test(sentence)) {
      push(
        "objection",
        objectionSignalValueSchema.parse({
          topic: "partner",
          disqualifier: false,
        }),
        excerptAround(sentence, sentence.slice(0, 40)),
      );
    }
  }

  return extractDocumentResultSchema.parse({
    extractor: EXTRACTOR_ID,
    findings,
    optOut,
  });
}

export function foldExtractedSignals(
  findings: readonly ExtractedSignal[],
): ExtractedScoreFacts {
  let statedProgramFee = false;
  let sawFitYes = false;
  let sawFitNo = false;
  let timeline: ExtractedScoreFacts["timeline"] = "unknown";

  for (const finding of findings) {
    if (finding.kind === "aum_or_budget") {
      const value = aumOrBudgetSignalValueSchema.safeParse(finding.value);
      if (
        value.success &&
        value.data.capitalKind === "program_fee" &&
        value.data.amountUsd !== null
      ) {
        statedProgramFee = true;
      }
    }
    if (finding.kind === "program_fit") {
      const value = programFitSignalValueSchema.safeParse(finding.value);
      if (value.success && value.data.fit === "yes") {
        sawFitYes = true;
      }
      if (value.success && value.data.fit === "no") {
        sawFitNo = true;
      }
    }
    if (finding.kind === "decision_timeline") {
      const value = decisionTimelineSignalValueSchema.safeParse(finding.value);
      if (value.success) {
        if (value.data.urgency === "now") {
          timeline = "now";
        } else if (value.data.urgency === "this_quarter" && timeline !== "now") {
          timeline = "this_quarter";
        } else if (timeline === "unknown") {
          timeline = "later";
        }
      }
    }
  }

  return {
    statedProgramFee,
    explicitProgramFit: sawFitYes && !sawFitNo ? "yes" : "unknown",
    timeline,
  };
}

export function extractedSourceFor(
  sourceType: PersonSignalSource,
): "gmail" | "operator" {
  return sourceType === "email_message" ? "gmail" : "operator";
}
