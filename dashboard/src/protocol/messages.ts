/** Message types exchanged between agent and dashboard over WebSocket. */

// Agent → Dashboard
export interface AuthMessage {
  type: "auth";
  agentId: string;
  secret: string;
  protocolVersion: number;
}

export interface HeartbeatMessage {
  type: "heartbeat";
  agentId: string;
  version: string;
  managers: ManagerInfo[];
  timestamp: string;
}

export interface ManagerInfo {
  name: string;
  displayName: string;
  ready: boolean;
  enabled: boolean;
}

export interface StateSnapshotMessage {
  type: "state_snapshot";
  agentId: string;
  full: boolean; // true = full snapshot, false = diff
  installedPackages: PackageInfo[];
  pendingUpdates: PackageInfo[];
  sources: SourceInfo[];
}

export interface PackageInfo {
  id: string;
  name: string;
  version: string;
  newVersion?: string;
  manager: string;
  source: string;
}

export interface SourceInfo {
  name: string;
  url: string;
  manager: string;
}

export interface OperationLogMessage {
  type: "operation_log";
  operationId: string;
  line: string;
  lineType: string;
  timestamp: string;
}

export interface OperationResultMessage {
  type: "operation_result";
  operationId: string;
  status: "completed" | "failed" | "cancelled";
  timestamp: string;
}

export interface ApprovalRequestMessage {
  type: "approval_request";
  operationId: string;
  packageId: string;
  manager: string;
  action: string;
  reason: string;
}

// Dashboard → Agent
export interface PolicySyncMessage {
  type: "policy_sync";
  policies: PolicyDocument;
  ttlSeconds: number;
}

export interface PolicyDocument {
  sourceAllowlist: Record<string, string[]>; // manager -> allowed source URLs
  packageBlocklist: { manager: string; packageId: string }[];
  hashSkipProhibited: boolean;
  commandAllowlist: string[];
  approvalCriteria: {
    elevated: boolean;
    nonAllowlistedSource: boolean;
    firstTimePackage: boolean;
  };
}

export interface OperationPushMessage {
  type: "operation_push";
  operationId: string;
  action: "install" | "update" | "uninstall";
  packageId: string;
  manager: string;
  version?: string;
  options?: Record<string, unknown>;
}

export interface ApprovalResponseMessage {
  type: "approval_response";
  operationId: string;
  approved: boolean;
}

export interface RevocationMessage {
  type: "revoked";
  reason: string;
}

export interface AckMessage {
  type: "ack";
  messageId?: string;
}

export type AgentMessage =
  | AuthMessage
  | HeartbeatMessage
  | StateSnapshotMessage
  | OperationLogMessage
  | OperationResultMessage
  | ApprovalRequestMessage;

export type DashboardMessage =
  | PolicySyncMessage
  | OperationPushMessage
  | ApprovalResponseMessage
  | RevocationMessage
  | AckMessage;

export const PROTOCOL_VERSION = 1;
