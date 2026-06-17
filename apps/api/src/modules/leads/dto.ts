import { LEAD_FIELD_KEYS } from "@10xconnect/core";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Sources (CLAUDE.md §8). CSV + an existing list are resolved internally; the
// rest resolve via the LeadSourceAdapter (Step 13).
// ---------------------------------------------------------------------------
export const LINKEDIN_SOURCE_KINDS = [
  "linkedin_search",
  "sales_navigator",
  "event",
  "post",
  "group",
  "lead_finder",
] as const;

// Upper bound on how many leads a single source-import pulls (account safety §6;
// the orchestration layer clamps real LinkedIn volume — this just bounds a job).
export const IMPORT_LIMIT_MAX = 1000;

const tagsSchema = z.array(z.string().trim().min(1).max(60)).max(50);

// Fields shared by every import: where the leads land + optional enrollment.
const targetFields = {
  listId: z.string().uuid().optional(),
  listName: z.string().trim().min(1).max(120).optional(),
  campaignId: z.string().uuid().optional(),
  tags: tagsSchema.optional(),
};

// CSV column → lead-field mapping (mirrors packages/core ColumnTarget).
const columnTargetSchema = z.union([
  z.enum([...LEAD_FIELD_KEYS]),
  z.literal("ignore"),
  z.object({ custom: z.string().trim().min(1).max(60) }),
]);
const columnMappingSchema = z.record(columnTargetSchema);

const leadFinderFiltersSchema = z
  .object({
    title: z.string().trim().max(120).optional(),
    company: z.string().trim().max(120).optional(),
    location: z.string().trim().max(120).optional(),
    industry: z.string().trim().max(120).optional(),
    connectionDegree: z.number().int().min(1).max(3).optional(),
    keywords: z.string().trim().max(200).optional(),
  })
  .strict();

const csvImportSchema = z
  .object({
    source: z.literal("csv"),
    csv: z.string().min(1, "CSV is empty").max(5_000_000),
    mapping: columnMappingSchema,
    ...targetFields,
  })
  .strict();

const listImportSchema = z
  .object({
    source: z.literal("list"),
    sourceListId: z.string().uuid(),
    ...targetFields,
  })
  .strict();

const linkedinImportSchema = z
  .object({
    source: z.enum(LINKEDIN_SOURCE_KINDS),
    url: z.string().url().max(2000).optional(),
    keywords: z.string().trim().max(200).optional(),
    filters: leadFinderFiltersSchema.optional(),
    engagement: z.enum(["likers", "commenters"]).optional(),
    /** Sending account whose LinkedIn session performs the search. */
    accountId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(IMPORT_LIMIT_MAX).optional(),
    ...targetFields,
  })
  .strict()
  .refine(
    (v) =>
      v.source === "lead_finder"
        ? Boolean(v.keywords || v.filters)
        : Boolean(v.url),
    { message: "url is required for this source (or keywords/filters for lead_finder)" },
  );

export const importRequestSchema = z.union([
  csvImportSchema,
  listImportSchema,
  linkedinImportSchema,
]);
export type ImportRequestDto = z.infer<typeof importRequestSchema>;

// POST /leads/find — built-in lead finder (a lead_finder import shortcut).
export const findRequestSchema = z
  .object({
    keywords: z.string().trim().max(200).optional(),
    filters: leadFinderFiltersSchema.optional(),
    accountId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(IMPORT_LIMIT_MAX).optional(),
    ...targetFields,
  })
  .strict()
  .refine((v) => Boolean(v.keywords || v.filters), {
    message: "Provide keywords or filters to find leads",
  });
export type FindRequestDto = z.infer<typeof findRequestSchema>;

// PATCH /leads/:id — edit identifiers, display fields, tags, custom columns.
export const updateLeadSchema = z
  .object({
    linkedinUrl: z.string().url().max(2000).nullable().optional(),
    email: z.string().email().max(255).nullable().optional(),
    tags: tagsSchema.optional(),
    customColumns: z.record(z.string().max(2000)).optional(),
    fields: z
      .object({
        firstName: z.string().trim().max(120).optional(),
        lastName: z.string().trim().max(120).optional(),
        company: z.string().trim().max(160).optional(),
        role: z.string().trim().max(160).optional(),
        headline: z.string().trim().max(300).optional(),
        location: z.string().trim().max(160).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });
export type UpdateLeadDto = z.infer<typeof updateLeadSchema>;

// POST /leads/bulk — multi-select actions from the contacts UI.
export const bulkActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_to_list"), leadIds: leadIds(), listId: z.string().uuid() }),
  z.object({ action: z.literal("remove_from_list"), leadIds: leadIds(), listId: z.string().uuid() }),
  z.object({ action: z.literal("add_tags"), leadIds: leadIds(), tags: tagsSchema }),
  z.object({ action: z.literal("remove_tags"), leadIds: leadIds(), tags: tagsSchema }),
  z.object({ action: z.literal("enroll_campaign"), leadIds: leadIds(), campaignId: z.string().uuid() }),
  z.object({ action: z.literal("delete"), leadIds: leadIds() }),
]);
export type BulkActionDto = z.infer<typeof bulkActionSchema>;

function leadIds() {
  return z.array(z.string().uuid()).min(1).max(1000);
}

// GET /leads query params.
export const listLeadsQuerySchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    listId: z.string().uuid().optional(),
    tag: z.string().trim().max(60).optional(),
    enrichStatus: z.enum(["pending", "enriching", "enriched", "failed"]).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  });
export type ListLeadsQueryDto = z.infer<typeof listLeadsQuerySchema>;
