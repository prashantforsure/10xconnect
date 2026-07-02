import { CAPPED_ACTION_TYPES } from "@10xconnect/core";
import { z } from "zod";

// --- Campaign CRUD ---------------------------------------------------------

/** AI reply autonomy chosen at creation — surfaced to the creator as Manual /
 * Balanced / Autopilot. Maps 1:1 to campaigns.autonomy.mode. Default = Balanced. */
export const aiReplyModeSchema = z.enum(["approve_all", "auto_easy_escalate_hard", "full_auto"]);
export type AiReplyMode = z.infer<typeof aiReplyModeSchema>;
export const DEFAULT_AI_REPLY_MODE: AiReplyMode = "auto_easy_escalate_hard";

export const createCampaignSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  /** Optional sending account to bind at creation (can be set later). */
  accountId: z.string().uuid().optional(),
  /** How autonomous the AI is on replies (default Balanced / auto_easy_escalate_hard). */
  aiReplyMode: aiReplyModeSchema.optional(),
});
export type CreateCampaignDto = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    /** null clears the binding; a uuid binds an account. */
    accountId: z.string().uuid().nullable().optional(),
    settings: z
      .object({
        skip_already_contacted: z.boolean().optional(),
        exclude_conn_req_from_reply_rate: z.boolean().optional(),
        follow_up_cap: z.number().int().min(0).max(20).optional(),
      })
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });
export type UpdateCampaignDto = z.infer<typeof updateCampaignSchema>;

// --- Frequency (per-action daily caps) -------------------------------------

// A partial caps map keyed by the capped action types. Missing keys fall back to
// defaults; values are clamped to safe maxima server-side (never trusted raw).
const capsShape = Object.fromEntries(
  CAPPED_ACTION_TYPES.map((t) => [t, z.number().int().min(0).max(10_000).optional()]),
) as Record<(typeof CAPPED_ACTION_TYPES)[number], z.ZodOptional<z.ZodNumber>>;

export const saveFrequencySchema = z.object({
  caps: z.object(capsShape),
});
export type SaveFrequencyDto = z.infer<typeof saveFrequencySchema>;

// --- Schedule (per-weekday working hours, UTC) -----------------------------

const HHMM = /^\d{1,2}:\d{2}$/;
const toMinutes = (s: string): number => {
  const [h = 0, m = 0] = s.split(":").map(Number);
  return h * 60 + m;
};
const isClockTime = (s: string): boolean => {
  const [h = -1, m = -1] = s.split(":").map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
};
const daySchedule = z
  .object({
    enabled: z.boolean(),
    start: z.string().regex(HHMM, "Use HH:MM (24h, UTC)"),
    end: z.string().regex(HHMM, "Use HH:MM (24h, UTC)"),
  })
  .refine((d) => isClockTime(d.start) && isClockTime(d.end), {
    message: "Times must be within 00:00–23:59",
  })
  // An inverted window (start ≥ end) would make the dispatch scheduler's
  // working-hours math undefined — reject it for enabled days (§6).
  .refine((d) => !d.enabled || toMinutes(d.start) < toMinutes(d.end), {
    message: "Start must be before end",
  });

export const saveScheduleSchema = z.object({
  schedule: z.object({
    sun: daySchedule,
    mon: daySchedule,
    tue: daySchedule,
    wed: daySchedule,
    thu: daySchedule,
    fri: daySchedule,
    sat: daySchedule,
  }),
});
export type SaveScheduleDto = z.infer<typeof saveScheduleSchema>;

// --- Sequence graph (builder save/load) ------------------------------------

const sequenceNodeSchema = z.object({
  /** Client-side node id (any unique string); remapped to a uuid on save. */
  id: z.string().min(1),
  kind: z.enum(["action", "condition"]),
  type: z.string().min(1).max(64),
  config: z.record(z.unknown()).default({}),
  next: z.string().nullable().optional(),
  true: z.string().nullable().optional(),
  false: z.string().nullable().optional(),
  delayDays: z.number().int().min(0).max(365).nullable().optional(),
});
export type SequenceNodeDto = z.infer<typeof sequenceNodeSchema>;

export const saveSequenceSchema = z.object({
  nodes: z.array(sequenceNodeSchema).max(200),
});
export type SaveSequenceDto = z.infer<typeof saveSequenceSchema>;

// --- AI campaign generator (E4) --------------------------------------------

const genIntakeSchema = z.object({
  offer: z.string().trim().min(1).max(600),
  audience: z.string().trim().min(1).max(600),
  goal: z.string().trim().min(1).max(600),
  tone: z.enum(["gentle", "balanced", "aggressive"]),
  instructions: z.string().trim().max(1200).optional(),
});

const genNodeSchema = z.object({
  kind: z.enum(["action", "condition"]),
  type: z.string().min(1).max(64),
  config: z.record(z.unknown()).default({}),
});

export const generateCampaignSchema = z
  .object({
    intake: genIntakeSchema.optional(),
    instruction: z.string().trim().min(1).max(500).optional(),
    currentGraph: z.array(genNodeSchema).max(60).optional(),
    /** Phase 6: emit a FULL campaign blueprint (graph + brain + KB seed), not just the graph. */
    full: z.boolean().optional(),
    /** Skip the clarifying-question flow and generate from the (possibly thin) intake anyway. */
    skipClarify: z.boolean().optional(),
  })
  .refine((v) => v.intake || (v.instruction && v.currentGraph), {
    message: "Provide an intake, or an instruction with the current graph.",
  });
export type GenerateCampaignDto = z.infer<typeof generateCampaignSchema>;

// --- Duplicate + A/B comparison (Phase 7.2) --------------------------------

export const duplicateCampaignSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
});
export type DuplicateCampaignDto = z.infer<typeof duplicateCampaignSchema>;

export const abCompareSchema = z.object({
  campaignIds: z.array(z.string().uuid()).min(2).max(10),
});
export type AbCompareDto = z.infer<typeof abCompareSchema>;

// --- Enroll leads ----------------------------------------------------------

export const enrollLeadsSchema = z
  .object({
    leadIds: z.array(z.string().uuid()).max(5000).optional(),
    listId: z.string().uuid().optional(),
    /** Enroll every contact in the workspace (respects suppression + skip-already-contacted). */
    allContacts: z.boolean().optional(),
  })
  .refine((v) => (v.leadIds && v.leadIds.length > 0) || v.listId || v.allContacts, {
    message: "Provide leadIds, a listId, or allContacts",
  });
export type EnrollLeadsDto = z.infer<typeof enrollLeadsSchema>;
