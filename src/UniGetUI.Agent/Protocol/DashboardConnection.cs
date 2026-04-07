using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using UniGetUI.Agent.Enrollment;
using UniGetUI.Core.Data;

namespace UniGetUI.Agent.Protocol;

/// <summary>
/// Manages the persistent outbound WebSocket connection from the agent to the dashboard.
/// Handles authentication, auto-reconnect with exponential backoff, and message routing.
/// </summary>
public sealed class DashboardConnection : IDisposable
{
    private const int PROTOCOL_VERSION = 1;
    private static readonly int[] BackoffSeconds = [1, 2, 4, 8, 16, 30, 60];

    private readonly AgentCredential _credential;
    private readonly ILogger<DashboardConnection> _logger;
    private ClientWebSocket? _ws;
    private int _reconnectAttempt;
    private bool _disposed;

    public event Action<string>? OnMessageReceived;
    public bool IsConnected => _ws?.State == WebSocketState.Open;

    // Degraded mode state machine: Connected → Disconnected (within TTL) → Degraded (TTL expired)
    public ConnectionState State { get; private set; } = ConnectionState.Disconnected;
    private DateTime _disconnectedAt = DateTime.MinValue;
    private int _policyTtlSeconds = 3600; // default 1 hour

    public void SetPolicyTtl(int ttlSeconds) => _policyTtlSeconds = ttlSeconds;

    public bool IsDegraded => State == ConnectionState.Degraded;

    private void UpdateConnectionState()
    {
        if (_ws?.State == WebSocketState.Open)
        {
            State = ConnectionState.Connected;
            return;
        }

        if (State == ConnectionState.Connected)
        {
            State = ConnectionState.Disconnected;
            _disconnectedAt = DateTime.UtcNow;
        }
        else if (State == ConnectionState.Disconnected &&
                 DateTime.UtcNow - _disconnectedAt > TimeSpan.FromSeconds(_policyTtlSeconds))
        {
            State = ConnectionState.Degraded;
            _logger.LogWarning("Policy TTL expired — agent entering degraded mode. All operations blocked.");
        }
    }

    public DashboardConnection(AgentCredential credential, ILogger<DashboardConnection> logger)
    {
        _credential = credential;
        _logger = logger;
    }

    /// <summary>
    /// Connect to the dashboard and maintain the connection. Blocks until cancelled.
    /// </summary>
    public async Task RunAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await ConnectAndRunAsync(ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Dashboard connection lost. Reconnecting...");
            }

            if (ct.IsCancellationRequested) break;

            UpdateConnectionState();

            int delay = BackoffSeconds[Math.Min(_reconnectAttempt, BackoffSeconds.Length - 1)];
            _logger.LogInformation("Reconnecting in {Delay}s (attempt {Attempt})...", delay, _reconnectAttempt + 1);
            await Task.Delay(TimeSpan.FromSeconds(delay), ct);
            _reconnectAttempt++;
        }
    }

    private async Task ConnectAndRunAsync(CancellationToken ct)
    {
        _ws?.Dispose();
        _ws = new ClientWebSocket();
        _ws.Options.SetRequestHeader("X-Protocol-Version", PROTOCOL_VERSION.ToString());

        var wsUrl = _credential.DashboardUrl
            .Replace("https://", "wss://")
            .Replace("http://", "ws://")
            + "/ws/agent";

        _logger.LogInformation("Connecting to {Url}...", wsUrl);
        await _ws.ConnectAsync(new Uri(wsUrl), ct);
        _logger.LogInformation("Connected to dashboard.");

        // Authenticate — send credential in first message (not URL query string, R31)
        var authMsg = JsonSerializer.Serialize(new
        {
            type = "auth",
            agentId = _credential.AgentId,
            secret = _credential.Secret,
            protocolVersion = PROTOCOL_VERSION,
        }, SerializationHelpers.DefaultOptions);
        await SendRawAsync(authMsg, ct);

        // Wait for ack
        var response = await ReceiveAsync(ct);
        if (response is null)
        {
            throw new InvalidOperationException("No response to auth message");
        }

        var parsed = JsonSerializer.Deserialize<JsonElement>(response, SerializationHelpers.DefaultOptions);
        var msgType = parsed.GetProperty("type").GetString();

        if (msgType == "revoked")
        {
            _logger.LogError("Agent has been revoked by the dashboard. Stopping.");
            throw new OperationCanceledException("Agent revoked");
        }

        if (msgType != "ack")
        {
            throw new InvalidOperationException($"Unexpected auth response: {msgType}");
        }

        _reconnectAttempt = 0;
        _logger.LogInformation("Authenticated with dashboard.");

        // Receive loop
        while (_ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            var message = await ReceiveAsync(ct);
            if (message is not null)
            {
                OnMessageReceived?.Invoke(message);
            }
        }
    }

    public async Task SendAsync(object message, CancellationToken ct = default)
    {
        var json = JsonSerializer.Serialize(message, SerializationHelpers.DefaultOptions);
        await SendRawAsync(json, ct);
    }

    private async Task SendRawAsync(string json, CancellationToken ct)
    {
        if (_ws?.State != WebSocketState.Open)
        {
            _logger.LogWarning("Cannot send — WebSocket not connected");
            return;
        }

        var bytes = Encoding.UTF8.GetBytes(json);
        await _ws.SendAsync(bytes, WebSocketMessageType.Text, true, ct);
    }

    private async Task<string?> ReceiveAsync(CancellationToken ct)
    {
        if (_ws is null) return null;

        var buffer = new byte[8192];
        var sb = new StringBuilder();

        WebSocketReceiveResult result;
        do
        {
            result = await _ws.ReceiveAsync(buffer, ct);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                return null;
            }
            sb.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
        } while (!result.EndOfMessage);

        return sb.ToString();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _ws?.Dispose();
    }
}

public enum ConnectionState
{
    Connected,
    Disconnected,
    Degraded,
}
