using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using UniGetUI.Agent;

var builder = Host.CreateApplicationBuilder(args);

// Configure as Windows Service
builder.Services.AddWindowsService(options =>
{
    options.ServiceName = "UniGetUI Agent";
});

// Load configuration
var config = new AgentConfiguration();
builder.Configuration.GetSection("Agent").Bind(config);
builder.Services.AddSingleton(config);

// Configure logging — filter out credential material
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
builder.Logging.AddFilter("Microsoft.Hosting", LogLevel.Information);

// Register the agent service
builder.Services.AddHostedService<AgentService>();

var host = builder.Build();
await host.RunAsync();
