using System.Net.Http.Json;
using System.Text.Json;

namespace UniGetUI.Agent.Enrollment;

/// <summary>
/// Handles one-time enrollment with the dashboard server.
/// Presents an enrollment token, receives a machine credential (UUID + secret),
/// and stores it via CredentialStore.
/// </summary>
public sealed class EnrollmentClient
{
    private readonly CredentialStore _credentialStore;
    private readonly ILogger<EnrollmentClient> _logger;

    public EnrollmentClient(CredentialStore credentialStore, ILogger<EnrollmentClient> logger)
    {
        _credentialStore = credentialStore;
        _logger = logger;
    }

    /// <summary>
    /// Enroll this agent with the dashboard using a one-time token.
    /// Returns the credential on success, or throws on failure.
    /// Never logs the token or secret (R31).
    /// </summary>
    public async Task<AgentCredential> EnrollAsync(string dashboardUrl, string enrollmentToken, CancellationToken ct = default)
    {
        _logger.LogInformation("Enrolling with dashboard at {Url}...", dashboardUrl);

        using var httpClient = new HttpClient
        {
            BaseAddress = new Uri(dashboardUrl.TrimEnd('/')),
            Timeout = TimeSpan.FromSeconds(30),
        };

        var hostname = Environment.MachineName;

        var request = new
        {
            token = enrollmentToken,
            hostname,
        };

        var response = await httpClient.PostAsJsonAsync("/api/enrollment/enroll", request, ct);

        if (!response.IsSuccessStatusCode)
        {
            var errorBody = await response.Content.ReadAsStringAsync(ct);
            _logger.LogError("Enrollment failed with status {Status}: {Body}",
                (int)response.StatusCode, errorBody);
            throw new InvalidOperationException($"Enrollment failed: {response.StatusCode}");
        }

        var result = await response.Content.ReadFromJsonAsync<EnrollmentResponse>(ct)
            ?? throw new InvalidOperationException("Empty enrollment response");

        var credential = new AgentCredential
        {
            AgentId = result.AgentId,
            Secret = result.Secret,
            DashboardUrl = dashboardUrl.TrimEnd('/'),
        };

        _credentialStore.Save(credential);
        _logger.LogInformation("Enrollment successful. Agent ID assigned.");

        return credential;
    }

    /// <summary>
    /// Load existing credential or enroll if --dashboard-url and --enrollment-token are provided.
    /// </summary>
    public async Task<AgentCredential?> GetOrEnrollAsync(string[] args, CancellationToken ct = default)
    {
        // Try loading existing credential first
        var existing = _credentialStore.Load();
        if (existing is not null)
        {
            _logger.LogInformation("Using stored credential for agent {AgentId}.", existing.AgentId);
            return existing;
        }

        // Check CLI args for enrollment
        string? dashboardUrl = GetArg(args, "--dashboard-url");
        string? token = GetArg(args, "--enrollment-token");

        if (dashboardUrl is null || token is null)
        {
            _logger.LogWarning("No stored credential and no enrollment args provided. " +
                "Use --dashboard-url <url> --enrollment-token <token> to enroll.");
            return null;
        }

        return await EnrollAsync(dashboardUrl, token, ct);
    }

    private static string? GetArg(string[] args, string name)
    {
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (args[i].Equals(name, StringComparison.OrdinalIgnoreCase))
                return args[i + 1];
        }
        return null;
    }

    private sealed class EnrollmentResponse
    {
        public string AgentId { get; set; } = "";
        public string Secret { get; set; } = "";
    }
}
