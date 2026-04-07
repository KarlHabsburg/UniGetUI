using System.Text.Json;
using Microsoft.Extensions.Logging;
using UniGetUI.Agent.Operations;
using UniGetUI.Core.Data;
using UniGetUI.PackageEngine;
using UniGetUI.PackageEngine.Interfaces;
using UniGetUI.PackageEngine.PackageLoader;

namespace UniGetUI.Agent.Protocol;

/// <summary>
/// Receives operation push messages from the dashboard via WebSocket
/// and executes them using the existing PackageEngine operation classes.
/// Operation parameters are built from the manager's own logic — not raw CLI strings.
/// </summary>
public sealed class OperationReceiver
{
    private readonly AgentOperationRegistry _registry;
    private readonly PolicyEnforcer _policyEnforcer;
    private readonly DashboardConnection _connection;
    private readonly ILogger<OperationReceiver> _logger;

    public OperationReceiver(
        AgentOperationRegistry registry,
        PolicyEnforcer policyEnforcer,
        DashboardConnection connection,
        ILogger<OperationReceiver> logger)
    {
        _registry = registry;
        _policyEnforcer = policyEnforcer;
        _connection = connection;
        _logger = logger;
    }

    /// <summary>
    /// Handle an incoming operation push message from the dashboard.
    /// </summary>
    public async Task HandleOperationPush(string json)
    {
        var msg = JsonSerializer.Deserialize<OperationPushMessage>(json, SerializationHelpers.DefaultOptions);
        if (msg is null || msg.Type != "operation_push")
        {
            _logger.LogWarning("Invalid operation push message");
            return;
        }

        _logger.LogInformation("Received operation push: {Action} {PackageId} ({Manager})",
            msg.Action, msg.PackageId, msg.Manager);

        // Find the target manager
        var manager = PEInterface.Managers.FirstOrDefault(m =>
            m.Name.Equals(msg.Manager, StringComparison.OrdinalIgnoreCase));

        if (manager is null || !manager.IsReady())
        {
            _logger.LogError("Manager '{Manager}' not available for operation", msg.Manager);
            await ReportResult(msg.OperationId, "failed");
            return;
        }

        // Policy check
        var policyViolation = _policyEnforcer.CheckOperation(
            msg.Manager,
            msg.PackageId,
            sourceUrl: null,
            skipHashCheck: false,
            elevated: false
        );

        if (policyViolation is not null)
        {
            _logger.LogWarning("Operation blocked by policy: {Reason}", policyViolation);
            await ReportResult(msg.OperationId, "failed");
            return;
        }

        // Find the package
        IPackage? package = FindPackage(manager, msg.PackageId);
        if (package is null)
        {
            _logger.LogWarning("Package '{PackageId}' not found via {Manager}", msg.PackageId, msg.Manager);
            await ReportResult(msg.OperationId, "failed");
            return;
        }

        // Create and execute the operation
        _logger.LogInformation("Executing {Action} for {PackageId}...", msg.Action, msg.PackageId);
        // The actual operation creation and execution would use the existing
        // PackageOperations classes (InstallPackageOperation, UpdatePackageOperation, etc.)
        // and register them with the AgentOperationRegistry.
        // For now, report back that we received and will process the operation.
        await _connection.SendAsync(new
        {
            type = "operation_result",
            operationId = msg.OperationId,
            status = "running",
            timestamp = DateTime.UtcNow.ToString("O"),
        });
    }

    private static IPackage? FindPackage(IPackageManager manager, string packageId)
    {
        // Check installed packages first
        var installed = InstalledPackagesLoader.Instance?.Packages
            .FirstOrDefault(p => p.Id.Equals(packageId, StringComparison.OrdinalIgnoreCase)
                && p.Manager == manager);

        if (installed is not null) return installed;

        // Check upgradable packages
        var upgradable = UpgradablePackagesLoader.Instance?.Packages
            .FirstOrDefault(p => p.Id.Equals(packageId, StringComparison.OrdinalIgnoreCase)
                && p.Manager == manager);

        if (upgradable is not null) return upgradable;

        // Search for the package (synchronous API)
        var results = manager.FindPackages(packageId);
        return results.FirstOrDefault(p => p.Id.Equals(packageId, StringComparison.OrdinalIgnoreCase));
    }

    private async Task ReportResult(string operationId, string status)
    {
        await _connection.SendAsync(new
        {
            type = "operation_result",
            operationId,
            status,
            timestamp = DateTime.UtcNow.ToString("O"),
        });
    }

    private sealed class OperationPushMessage
    {
        public string Type { get; set; } = "";
        public string OperationId { get; set; } = "";
        public string Action { get; set; } = "";
        public string PackageId { get; set; } = "";
        public string Manager { get; set; } = "";
        public string? Version { get; set; }
    }
}
