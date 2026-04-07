using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;
using UniGetUI.Core.Logging;
using UniGetUI.PackageOperations;

namespace UniGetUI.Agent.Operations;

/// <summary>
/// Persists operation metadata and log lines to a local SQLite database.
/// Supports recovery of pending operations after agent restart.
/// </summary>
public sealed partial class OperationLogStore : IDisposable
{
    private const long MaxLogBytesPerOperation = 10 * 1024 * 1024; // 10 MB

    private readonly SqliteConnection _connection;
    private readonly object _lock = new();

    public OperationLogStore(string dbPath)
    {
        _connection = new SqliteConnection($"Data Source={dbPath}");
        _connection.Open();
        InitializeSchema();
    }

    private void InitializeSchema()
    {
        using var cmd = _connection.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS operations (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                package_id TEXT NOT NULL DEFAULT '',
                manager TEXT NOT NULL DEFAULT '',
                version TEXT NOT NULL DEFAULT '',
                options_json TEXT NOT NULL DEFAULT '{}',
                status TEXT NOT NULL DEFAULT 'pending',
                initiated_by TEXT NOT NULL DEFAULT 'local',
                started_at TEXT,
                completed_at TEXT
            );

            CREATE TABLE IF NOT EXISTS operation_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                operation_id TEXT NOT NULL,
                line_number INTEGER NOT NULL,
                line_text TEXT NOT NULL,
                line_type TEXT NOT NULL,
                timestamp TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (operation_id) REFERENCES operations(id)
            );

            CREATE INDEX IF NOT EXISTS idx_operation_logs_op_id
                ON operation_logs(operation_id);

            CREATE INDEX IF NOT EXISTS idx_operations_status
                ON operations(status);
            """;
        cmd.ExecuteNonQuery();
    }

    /// <summary>
    /// Creates a new operation record.
    /// </summary>
    public void CreateOperation(string operationId, string type, string packageId = "",
        string manager = "", string version = "", string optionsJson = "{}", string initiatedBy = "local")
    {
        lock (_lock)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = """
                INSERT INTO operations (id, type, package_id, manager, version, options_json, status, initiated_by, started_at)
                VALUES ($id, $type, $packageId, $manager, $version, $optionsJson, 'pending', $initiatedBy, datetime('now'))
                """;
            cmd.Parameters.AddWithValue("$id", operationId);
            cmd.Parameters.AddWithValue("$type", type);
            cmd.Parameters.AddWithValue("$packageId", packageId);
            cmd.Parameters.AddWithValue("$manager", manager);
            cmd.Parameters.AddWithValue("$version", version);
            cmd.Parameters.AddWithValue("$optionsJson", optionsJson);
            cmd.Parameters.AddWithValue("$initiatedBy", initiatedBy);
            cmd.ExecuteNonQuery();
        }
    }

    /// <summary>
    /// Updates the status of an operation.
    /// </summary>
    public void UpdateStatus(string operationId, string status)
    {
        lock (_lock)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = status is "completed" or "failed" or "cancelled"
                ? "UPDATE operations SET status = $status, completed_at = datetime('now') WHERE id = $id"
                : "UPDATE operations SET status = $status WHERE id = $id";
            cmd.Parameters.AddWithValue("$id", operationId);
            cmd.Parameters.AddWithValue("$status", status);
            cmd.ExecuteNonQuery();
        }
    }

    /// <summary>
    /// Appends a log line to an operation, enforcing the 10 MB cap.
    /// ANSI escape sequences are stripped before storage.
    /// </summary>
    public void AppendLogLine(string operationId, int lineNumber, string text, string lineType)
    {
        string sanitized = StripAnsiEscapes(text);

        lock (_lock)
        {
            // Check current log size for this operation
            long currentSize = GetLogSize(operationId);
            long newSize = currentSize + System.Text.Encoding.UTF8.GetByteCount(sanitized);

            if (newSize > MaxLogBytesPerOperation)
            {
                // Check if we already added a truncation marker
                if (!HasTruncationMarker(operationId))
                {
                    InsertLogLine(operationId, lineNumber, "[truncated — 10 MB log limit reached]", "Information");
                }
                return;
            }

            InsertLogLine(operationId, lineNumber, sanitized, lineType);
        }
    }

    private void InsertLogLine(string operationId, int lineNumber, string text, string lineType)
    {
        using var cmd = _connection.CreateCommand();
        cmd.CommandText = """
            INSERT INTO operation_logs (operation_id, line_number, line_text, line_type, timestamp)
            VALUES ($operationId, $lineNumber, $text, $lineType, datetime('now'))
            """;
        cmd.Parameters.AddWithValue("$operationId", operationId);
        cmd.Parameters.AddWithValue("$lineNumber", lineNumber);
        cmd.Parameters.AddWithValue("$text", text);
        cmd.Parameters.AddWithValue("$lineType", lineType);
        cmd.ExecuteNonQuery();
    }

    private long GetLogSize(string operationId)
    {
        using var cmd = _connection.CreateCommand();
        cmd.CommandText = "SELECT COALESCE(SUM(LENGTH(line_text)), 0) FROM operation_logs WHERE operation_id = $id";
        cmd.Parameters.AddWithValue("$id", operationId);
        return (long)cmd.ExecuteScalar()!;
    }

    private bool HasTruncationMarker(string operationId)
    {
        using var cmd = _connection.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM operation_logs WHERE operation_id = $id AND line_text LIKE '%truncated%'";
        cmd.Parameters.AddWithValue("$id", operationId);
        return (long)cmd.ExecuteScalar()! > 0;
    }

    /// <summary>
    /// Returns operations that were not completed (for recovery after restart).
    /// </summary>
    public List<OperationRecord> GetPendingOperations()
    {
        lock (_lock)
        {
            var results = new List<OperationRecord>();
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = """
                SELECT id, type, package_id, manager, version, options_json, status, initiated_by, started_at
                FROM operations
                WHERE status IN ('pending', 'running', 'pending_approval')
                ORDER BY started_at ASC
                """;

            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                results.Add(new OperationRecord
                {
                    Id = reader.GetString(0),
                    Type = reader.GetString(1),
                    PackageId = reader.GetString(2),
                    Manager = reader.GetString(3),
                    Version = reader.GetString(4),
                    OptionsJson = reader.GetString(5),
                    Status = reader.GetString(6),
                    InitiatedBy = reader.GetString(7),
                    StartedAt = reader.IsDBNull(8) ? null : reader.GetString(8),
                });
            }

            return results;
        }
    }

    /// <summary>
    /// Returns all log lines for a given operation, ordered by line number.
    /// </summary>
    public List<LogLineRecord> GetLogLines(string operationId)
    {
        lock (_lock)
        {
            var results = new List<LogLineRecord>();
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = """
                SELECT line_number, line_text, line_type, timestamp
                FROM operation_logs
                WHERE operation_id = $id
                ORDER BY line_number ASC
                """;
            cmd.Parameters.AddWithValue("$id", operationId);

            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                results.Add(new LogLineRecord
                {
                    LineNumber = reader.GetInt32(0),
                    Text = reader.GetString(1),
                    LineType = reader.GetString(2),
                    Timestamp = reader.GetString(3),
                });
            }

            return results;
        }
    }

    /// <summary>
    /// Strips ANSI escape sequences from a string.
    /// </summary>
    internal static string StripAnsiEscapes(string input)
    {
        return AnsiEscapeRegex().Replace(input, string.Empty);
    }

    [GeneratedRegex(@"\x1B\[[0-9;]*[A-Za-z]|\x1B\].*?\x07|\x1B[()][A-Za-z0-9]")]
    private static partial Regex AnsiEscapeRegex();

    public void Dispose()
    {
        _connection.Close();
        _connection.Dispose();
    }
}

public sealed class OperationRecord
{
    public required string Id { get; init; }
    public required string Type { get; init; }
    public required string PackageId { get; init; }
    public required string Manager { get; init; }
    public required string Version { get; init; }
    public required string OptionsJson { get; init; }
    public required string Status { get; init; }
    public required string InitiatedBy { get; init; }
    public string? StartedAt { get; init; }
}

public sealed class LogLineRecord
{
    public required int LineNumber { get; init; }
    public required string Text { get; init; }
    public required string LineType { get; init; }
    public required string Timestamp { get; init; }
}
