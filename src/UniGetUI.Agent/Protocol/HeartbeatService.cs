using Microsoft.Extensions.Logging;
using UniGetUI.Core.Data;
using UniGetUI.PackageEngine;
using UniGetUI.PackageEngine.Interfaces;
using UniGetUI.PackageEngine.PackageLoader;

namespace UniGetUI.Agent.Protocol;

/// <summary>
/// Sends periodic heartbeats and state snapshots to the dashboard via DashboardConnection.
/// Heartbeat every 5 min (configurable). Full state snapshot every 6th heartbeat (30 min).
/// </summary>
public sealed class HeartbeatService
{
    private readonly DashboardConnection _connection;
    private readonly AgentConfiguration _config;
    private readonly ILogger<HeartbeatService> _logger;
    private int _heartbeatCount;

    public HeartbeatService(
        DashboardConnection connection,
        AgentConfiguration config,
        ILogger<HeartbeatService> logger)
    {
        _connection = connection;
        _config = config;
        _logger = logger;
    }

    public async Task RunAsync(CancellationToken ct)
    {
        // Send initial full snapshot
        await SendStateSnapshotAsync(full: true, ct);

        while (!ct.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromSeconds(_config.HeartbeatIntervalSeconds), ct);

            if (!_connection.IsConnected) continue;

            await SendHeartbeatAsync(ct);
            _heartbeatCount++;

            // Full snapshot every 6th heartbeat
            if (_heartbeatCount % 6 == 0)
            {
                await SendStateSnapshotAsync(full: true, ct);
            }
        }
    }

    private async Task SendHeartbeatAsync(CancellationToken ct)
    {
        var managers = PEInterface.Managers.Select(m => new
        {
            name = m.Name,
            displayName = m.DisplayName,
            ready = m.IsReady(),
            enabled = m.IsEnabled(),
        }).ToArray();

        var heartbeat = new
        {
            type = "heartbeat",
            agentId = "", // filled by DashboardConnection from credential
            version = CoreData.BuildNumber.ToString(),
            managers,
            timestamp = DateTime.UtcNow.ToString("O"),
        };

        await _connection.SendAsync(heartbeat, ct);
        _logger.LogDebug("Heartbeat sent.");
    }

    private async Task SendStateSnapshotAsync(bool full, CancellationToken ct)
    {
        if (!_connection.IsConnected) return;

        var installed = GetInstalledPackages();
        var updates = GetPendingUpdates();
        var sources = GetSources();

        var snapshot = new
        {
            type = "state_snapshot",
            agentId = "",
            full,
            installedPackages = installed,
            pendingUpdates = updates,
            sources,
        };

        await _connection.SendAsync(snapshot, ct);
        _logger.LogInformation("State snapshot sent ({Type}): {Installed} installed, {Updates} updates",
            full ? "full" : "diff", installed.Length, updates.Length);
    }

    private static object[] GetInstalledPackages()
    {
        if (InstalledPackagesLoader.Instance is null) return [];
        return InstalledPackagesLoader.Instance.Packages
            .Select(p => new
            {
                id = p.Id,
                name = p.Name,
                version = p.VersionString,
                manager = p.Manager.Name,
                source = p.Source.Name,
            })
            .ToArray<object>();
    }

    private static object[] GetPendingUpdates()
    {
        if (UpgradablePackagesLoader.Instance is null) return [];
        return UpgradablePackagesLoader.Instance.Packages
            .Select(p => new
            {
                id = p.Id,
                name = p.Name,
                version = p.VersionString,
                newVersion = p.NewVersionString,
                manager = p.Manager.Name,
                source = p.Source.Name,
            })
            .ToArray<object>();
    }

    private static object[] GetSources()
    {
        return PEInterface.Managers
            .Where(m => m.IsReady())
            .SelectMany(m =>
            {
                try
                {
                    var sources = m.SourcesHelper?.GetSources();
                    if (sources is null) return [];
                    return sources.Select(s => new
                    {
                        name = s.Name,
                        url = s.Url?.ToString() ?? "",
                        manager = m.Name,
                    });
                }
                catch
                {
                    return [];
                }
            })
            .ToArray<object>();
    }
}
