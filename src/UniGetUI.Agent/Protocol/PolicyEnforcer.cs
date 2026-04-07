using System.Text.Json;
using Microsoft.Extensions.Logging;
using UniGetUI.Core.Data;

namespace UniGetUI.Agent.Protocol;

/// <summary>
/// Enforces policies received from the dashboard. Stores the current policy
/// locally with a TTL. When the TTL expires, the agent enters degraded mode
/// and refuses all new operations.
/// </summary>
public sealed class PolicyEnforcer
{
    private readonly ILogger<PolicyEnforcer> _logger;
    private PolicyDocument? _currentPolicy;
    private DateTime _policyExpiresAt = DateTime.MinValue;

    public PolicyEnforcer(ILogger<PolicyEnforcer> logger)
    {
        _logger = logger;
    }

    public bool HasValidPolicy => _currentPolicy is not null && DateTime.UtcNow < _policyExpiresAt;
    public bool IsDegraded => _currentPolicy is not null && DateTime.UtcNow >= _policyExpiresAt;

    /// <summary>
    /// Update the locally cached policy from a dashboard push.
    /// </summary>
    public void UpdatePolicy(string policyJson, int ttlSeconds)
    {
        _currentPolicy = JsonSerializer.Deserialize<PolicyDocument>(policyJson, SerializationHelpers.DefaultOptions);
        _policyExpiresAt = DateTime.UtcNow.AddSeconds(ttlSeconds);
        _logger.LogInformation("Policy updated. TTL: {TTL}s, expires at {Expires}", ttlSeconds, _policyExpiresAt);
    }

    /// <summary>
    /// Check whether an operation is allowed under the current policy.
    /// Returns null if allowed, or an error message if blocked.
    /// </summary>
    public string? CheckOperation(string manager, string packageId, string? sourceUrl, bool skipHashCheck, bool elevated)
    {
        if (_currentPolicy is null)
        {
            // No policy received yet — allow (first-run before enrollment)
            return null;
        }

        if (DateTime.UtcNow >= _policyExpiresAt)
        {
            return "Policy expired — agent is in degraded mode. All operations are blocked until the dashboard connection is restored.";
        }

        // Check package blocklist
        foreach (var blocked in _currentPolicy.PackageBlocklist)
        {
            if (blocked.Manager.Equals(manager, StringComparison.OrdinalIgnoreCase) &&
                blocked.PackageId.Equals(packageId, StringComparison.OrdinalIgnoreCase))
            {
                return $"Package '{packageId}' is blocklisted by fleet policy.";
            }
        }

        // Check source allowlist
        if (sourceUrl is not null && _currentPolicy.SourceAllowlist.TryGetValue(manager, out var allowedSources))
        {
            if (allowedSources.Length > 0 && !allowedSources.Any(s => sourceUrl.StartsWith(s, StringComparison.OrdinalIgnoreCase)))
            {
                return $"Source '{sourceUrl}' is not in the approved source list for {manager}.";
            }
        }

        // Check hash skip prohibition
        if (skipHashCheck && _currentPolicy.HashSkipProhibited)
        {
            return "SkipHashCheck is prohibited by fleet policy.";
        }

        return null;
    }

    /// <summary>
    /// Check whether a pre/post-operation command is on the allowlist.
    /// Default posture is deny — no commands execute unless explicitly allowed.
    /// </summary>
    public bool IsCommandAllowed(string command)
    {
        if (_currentPolicy is null) return false; // deny by default
        return _currentPolicy.CommandAllowlist.Contains(command, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Check whether an operation requires approval based on the configured criteria.
    /// </summary>
    public bool RequiresApproval(bool elevated, bool nonAllowlistedSource, bool firstTimePackage)
    {
        if (_currentPolicy?.ApprovalCriteria is null) return false;
        var criteria = _currentPolicy.ApprovalCriteria;

        return (criteria.Elevated && elevated) ||
               (criteria.NonAllowlistedSource && nonAllowlistedSource) ||
               (criteria.FirstTimePackage && firstTimePackage);
    }
}

public sealed class PolicyDocument
{
    public Dictionary<string, string[]> SourceAllowlist { get; set; } = new();
    public BlocklistEntry[] PackageBlocklist { get; set; } = [];
    public bool HashSkipProhibited { get; set; }
    public string[] CommandAllowlist { get; set; } = [];
    public ApprovalCriteriaConfig? ApprovalCriteria { get; set; }
}

public sealed class BlocklistEntry
{
    public string Manager { get; set; } = "";
    public string PackageId { get; set; } = "";
}

public sealed class ApprovalCriteriaConfig
{
    public bool Elevated { get; set; }
    public bool NonAllowlistedSource { get; set; }
    public bool FirstTimePackage { get; set; }
}
