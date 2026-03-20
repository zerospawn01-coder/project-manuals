export const PLAN_ENTRY_MIGRATION_MODES = [
  'copy',
  'filter-repo',
  'archive',
  'exclude',
] as const;

export const PLAN_ENTRY_CONFIDENCE_LEVELS = ['confirmed', 'provisional'] as const;

export const PLAN_ENTRY_DISPOSITIONS = [
  'migrate',
  'deferred',
  'exclude',
  'archive',
] as const;

export type PlanEntryMigrationMode = (typeof PLAN_ENTRY_MIGRATION_MODES)[number];
export type PlanEntryConfidence = (typeof PLAN_ENTRY_CONFIDENCE_LEVELS)[number];
export type PlanEntryDisposition = (typeof PLAN_ENTRY_DISPOSITIONS)[number];

export interface PlanEntry {
  sourcePath: string;
  category: string;
  targetRepo: string;
  targetPath: string;
  migrationMode: PlanEntryMigrationMode;
  confidence: PlanEntryConfidence;
  disposition: PlanEntryDisposition;
  notes?: string;
}

export const planEntrySchema = {
  type: 'object',
  required: [
    'sourcePath',
    'category',
    'targetRepo',
    'targetPath',
    'migrationMode',
    'confidence',
    'disposition',
  ],
  properties: {
    sourcePath: { type: 'string' },
    category: { type: 'string' },
    targetRepo: { type: 'string' },
    targetPath: { type: 'string' },
    migrationMode: {
      type: 'string',
      enum: [...PLAN_ENTRY_MIGRATION_MODES],
    },
    confidence: {
      type: 'string',
      enum: [...PLAN_ENTRY_CONFIDENCE_LEVELS],
    },
    disposition: {
      type: 'string',
      enum: [...PLAN_ENTRY_DISPOSITIONS],
    },
    notes: { type: 'string' },
  },
  additionalProperties: false,
} as const;
