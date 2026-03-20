import { createHash } from 'node:crypto';

export const ARTIFACT_KINDS = ['plan', 'preview', 'execution', 'log'] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export interface ArtifactMetadata {
  kind: ArtifactKind;
  layout?: string;
  phase?: string;
  planHash?: string;
  createdAt?: string;
  operator?: string;
  destructive?: boolean;
}

function sanitizeTimestamp(timestamp: string): string {
  return timestamp.replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
}

export function buildArtifactId(kind: ArtifactKind, seed: string, createdAt = new Date().toISOString()): string {
  const shortHash = createHash('sha256').update(seed).digest('hex').slice(0, 6);
  return `repo-split/${kind}/${sanitizeTimestamp(createdAt)}-${shortHash}`;
}

export function createArtifactMetadata(kind: ArtifactKind, seed: string, partial: Omit<ArtifactMetadata, 'kind' | 'createdAt'> = {}): ArtifactMetadata & { artifactId: string } {
  const createdAt = new Date().toISOString();
  return {
    artifactId: buildArtifactId(kind, seed, createdAt),
    kind,
    createdAt,
    ...partial,
  };
}
