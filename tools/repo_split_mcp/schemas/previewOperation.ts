export const PREVIEW_PHASES = ['copy', 'filter-repo', 'archive'] as const;

export type PreviewPhase = (typeof PREVIEW_PHASES)[number];

export interface PreviewOperation {
  phase: PreviewPhase;
  action: string;
  sourcePath: string;
  targetRepo: string;
  targetPath: string;
  destructive: boolean;
  requiresConfirmation?: boolean;
  warnings?: string[];
}

export const previewOperationSchema = {
  type: 'object',
  required: [
    'phase',
    'action',
    'sourcePath',
    'targetRepo',
    'targetPath',
    'destructive',
  ],
  properties: {
    phase: {
      type: 'string',
      enum: [...PREVIEW_PHASES],
    },
    action: { type: 'string' },
    sourcePath: { type: 'string' },
    targetRepo: { type: 'string' },
    targetPath: { type: 'string' },
    destructive: { type: 'boolean' },
    requiresConfirmation: { type: 'boolean' },
    warnings: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  additionalProperties: false,
} as const;
