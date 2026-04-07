using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using UniGetUI.Core.Data;
using UniGetUI.Core.Logging;
using UniGetUI.Core.Tools;
using UniGetUI.PackageEngine;
using UniGetUI.PackageEngine.Interfaces;

namespace UniGetUI.Agent;

/// <summary>
/// The core agent service that initializes the PackageEngine and runs a local HTTP API.
/// Designed to run as a Windows Service (Session 0, no GUI).
/// </summary>
public sealed class AgentService : BackgroundService
{
    private readonly AgentConfiguration _config;
    private readonly ILogger<AgentService> _logger;
    private IHost? _apiHost;
    private bool _engineReady;

    public AgentService(AgentConfiguration config, ILogger<AgentService> logger)
    {
        _config = config;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("UniGetUI Agent starting...");

        // Step 1: Initialize loaders FIRST (ordering constraint — operation success
        // handlers call InstalledPackagesLoader.Instance.AddForeign() which NullRefs
        // if the singleton is not initialized)
        _logger.LogInformation("Initializing package loaders...");
        PEInterface.LoadLoaders();

        // Step 2: Initialize all package managers
        _logger.LogInformation("Initializing package managers (timeout: {Timeout}s)...", _config.ManagerLoadTimeoutSeconds);
        PEInterface.LoadManagers();

        LogAvailableManagers();
        _engineReady = true;

        // Step 3: Start the local HTTP API (only after engine is ready)
        _logger.LogInformation("Starting local HTTP API on port {Port}...", _config.ApiPort);
        await StartApiHost(stoppingToken);

        _logger.LogInformation("UniGetUI Agent is ready.");

        // Keep the service running until cancellation is requested
        try
        {
            await Task.Delay(Timeout.Infinite, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("UniGetUI Agent stopping...");
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        if (_apiHost is not null)
        {
            await _apiHost.StopAsync(cancellationToken);
            _logger.LogInformation("Local HTTP API stopped.");
        }

        await base.StopAsync(cancellationToken);
    }

    private async Task StartApiHost(CancellationToken stoppingToken)
    {
        string listenUrl = $"http://localhost:{_config.ApiPort}";

        var builder = Host.CreateDefaultBuilder();
        builder.ConfigureWebHostDefaults(webBuilder =>
        {
            webBuilder.UseKestrel();
            webBuilder.SuppressStatusMessages(true);
            webBuilder.Configure(app =>
            {
                app.UseRouting();
                app.UseEndpoints(endpoints =>
                {
                    endpoints.MapGet("/health", HealthEndpoint);
                    endpoints.MapGet("/managers", ManagersEndpoint);
                });
            });
            webBuilder.UseUrls(listenUrl);
        });

        _apiHost = builder.Build();
        await _apiHost.StartAsync(stoppingToken);
        _logger.LogInformation("Local HTTP API listening on {Url}", listenUrl);
    }

    private async Task HealthEndpoint(HttpContext context)
    {
        var health = new
        {
            status = _engineReady ? "healthy" : "initializing",
            agentVersion = CoreData.BuildNumber.ToString(),
            engineReady = _engineReady,
            managersAvailable = PEInterface.Managers.Count(m => m.IsReady()),
            managersTotal = PEInterface.Managers.Length,
        };

        context.Response.ContentType = "application/json";
        await context.Response.WriteAsync(JsonSerializer.Serialize(health));
    }

    private async Task ManagersEndpoint(HttpContext context)
    {
        var managers = PEInterface.Managers.Select(m => new
        {
            name = m.Name,
            displayName = m.DisplayName,
            ready = m.IsReady(),
            enabled = m.IsEnabled(),
        });

        context.Response.ContentType = "application/json";
        await context.Response.WriteAsync(JsonSerializer.Serialize(managers));
    }

    private void LogAvailableManagers()
    {
        foreach (IPackageManager manager in PEInterface.Managers)
        {
            string status = manager.IsReady() ? "ready" : (manager.IsEnabled() ? "enabled but not ready" : "disabled");
            _logger.LogInformation("  Manager {Name}: {Status}", manager.Name, status);
        }

        int readyCount = PEInterface.Managers.Count(m => m.IsReady());
        _logger.LogInformation("{Ready}/{Total} package managers initialized.", readyCount, PEInterface.Managers.Length);
    }
}
