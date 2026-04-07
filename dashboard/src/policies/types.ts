export interface SourceAllowlistPolicy {
  type: "source_allowlist";
  config: Record<string, string[]>; // manager -> allowed source URLs
}

export interface PackageBlocklistPolicy {
  type: "package_blocklist";
  config: { manager: string; packageId: string }[];
}

export interface HashPolicy {
  type: "hash_policy";
  config: { hashSkipProhibited: boolean };
}

export interface CommandAllowlistPolicy {
  type: "command_allowlist";
  config: { commands: string[] }; // exact-string matches, default-deny
}

export interface ApprovalCriteriaPolicy {
  type: "approval_criteria";
  config: {
    elevated: boolean;
    nonAllowlistedSource: boolean;
    firstTimePackage: boolean;
  };
}

export type PolicyType =
  | SourceAllowlistPolicy
  | PackageBlocklistPolicy
  | HashPolicy
  | CommandAllowlistPolicy
  | ApprovalCriteriaPolicy;

export type PolicyTypeName = PolicyType["type"];
