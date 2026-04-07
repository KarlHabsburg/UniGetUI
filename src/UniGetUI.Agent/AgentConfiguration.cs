namespace UniGetUI.Agent;

/// <summary>
/// Configuration for the UniGetUI Agent service.
/// </summary>
public sealed class AgentConfiguration
{
    /// <summary>
    /// The port the agent's local HTTP API listens on (loopback only).
    /// </summary>
    public int ApiPort { get; set; } = 7059;

    /// <summary>
    /// The interval in seconds between heartbeats sent to the dashboard.
    /// </summary>
    public int HeartbeatIntervalSeconds { get; set; } = 300;

    /// <summary>
    /// Maximum time in seconds to wait for all package managers to initialize.
    /// </summary>
    public int ManagerLoadTimeoutSeconds { get; set; } = 60;
}
