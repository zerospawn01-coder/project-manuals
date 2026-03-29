export type BlastRadius = 'SELF' | 'TENANT' | 'GLOBAL';

export interface GovernanceEnvelope {
  blast_radius: BlastRadius;
  risk_level?: 'low' | 'medium' | 'high' | 'critical';
}
