using UniGetUI.Agent;
using UniGetUI.Agent.Enrollment;
using UniGetUI.Agent.Operations;
using UniGetUI.Core.Data;

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

// Register enrollment infrastructure
builder.Services.AddSingleton<CredentialStore>();
builder.Services.AddSingleton<EnrollmentClient>();

// Register operation infrastructure
string dbPath = Path.Join(CoreData.UniGetUIDataDirectory, "agent-operations.db");
builder.Services.AddSingleton(new OperationLogStore(dbPath));
builder.Services.AddSingleton<AgentOperationQueue>();
builder.Services.AddSingleton<AgentOperationRegistry>();

// Register the agent service
builder.Services.AddHostedService<AgentService>();

var host = builder.Build();
await host.RunAsync();
