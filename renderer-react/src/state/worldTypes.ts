export interface WorldNode {
    id: string;
    type: string;
    data: Record<string, unknown>;
    position: { x: number; y: number };
}

export interface WorldEdge {
    id: string;
    source: string;
    target: string;
    animated?: boolean;
}

export interface AuditLogEntry {
    ts: string;
    action: string;
    details: string;
    type?: string;
    runbook?: {
        title: string;
        severity: string;
        steps: string[];
    };
    metadata?: Record<string, unknown>;
}

export interface WorldState {
    nodes: WorldNode[];
    edges: WorldEdge[];
    lastCommand: string;
    is3D: boolean;
    isSilent: boolean;
    auditLog: AuditLogEntry[];
    rollbackStatus: {
        fail: number;
        stable: number;
    };
    connected: boolean;
    // Determinism Metadata
    schemaVersion: number;
    runId: string;
    lastSeq: number;
    isSafeMode: boolean;
    isArmed: boolean;
    is2FAComplete: boolean;
}

export interface WorldPatch {
    schemaVersion: number;
    runId: string;
    source: string;
    seq: number;

    action?: string;
    nodes?: WorldNode[];
    edges?: WorldEdge[];
    lastCommand?: string;
    is3D?: boolean;
    isSilent?: boolean;
    auditLogEntry?: AuditLogEntry;
    rollbackStatus?: {
        fail: number;
        stable: number;
    };
    isArmed?: boolean;
    is2FAComplete?: boolean;
}
