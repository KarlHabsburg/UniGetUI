using UniGetUI.PackageEngine.Enums;
using UniGetUI.PackageOperations;

namespace UniGetUI.Agent.Operations;

/// <summary>
/// Headless operation registry for the agent. Subscribes to operation events
/// and persists logs to the OperationLogStore. No GUI dependencies.
/// Mirrors AvaloniaOperationRegistry but without UI binding.
/// </summary>
public sealed class AgentOperationRegistry
{
    private readonly OperationLogStore _logStore;
    private readonly AgentOperationQueue _queue;
    private readonly ILogger<AgentOperationRegistry> _logger;
    private readonly Dictionary<AbstractOperation, string> _operationIds = [];
    private readonly Dictionary<AbstractOperation, int> _lineCounters = [];
    private readonly object _lock = new();

    public AgentOperationRegistry(OperationLogStore logStore, AgentOperationQueue queue, ILogger<AgentOperationRegistry> logger)
    {
        _logStore = logStore;
        _queue = queue;
        _logger = logger;
    }

    /// <summary>
    /// Register an operation for headless tracking. Must be called before operation.MainThread().
    /// </summary>
    public void Add(AbstractOperation operation, string operationType = "unknown",
        string packageId = "", string manager = "", string version = "",
        string optionsJson = "{}", string initiatedBy = "local")
    {
        string operationId = Guid.NewGuid().ToString("N");

        lock (_lock)
        {
            _operationIds[operation] = operationId;
            _lineCounters[operation] = 0;
        }

        _queue.Enqueue(operation);
        _logStore.CreateOperation(operationId, operationType, packageId, manager, version, optionsJson, initiatedBy);

        _logger.LogInformation("Operation {OperationId} registered: {Type} {PackageId} ({Manager})",
            operationId, operationType, packageId, manager);

        operation.OperationStarting += (_, _) =>
        {
            _logStore.UpdateStatus(operationId, "running");
            _logger.LogInformation("Operation {OperationId} started.", operationId);
        };

        operation.LogLineAdded += (_, args) =>
        {
            var (text, lineType) = args;
            int lineNumber;
            lock (_lock)
            {
                lineNumber = _lineCounters.TryGetValue(operation, out int current) ? current : 0;
                _lineCounters[operation] = lineNumber + 1;
            }

            _logStore.AppendLogLine(operationId, lineNumber, text, lineType.ToString());
        };

        operation.OperationSucceeded += (_, _) =>
        {
            _logStore.UpdateStatus(operationId, "completed");
            _queue.Remove(operation);
            CleanupTracking(operation);
            _logger.LogInformation("Operation {OperationId} succeeded.", operationId);
        };

        operation.OperationFailed += (_, _) =>
        {
            _logStore.UpdateStatus(operationId, "failed");
            _queue.Remove(operation);
            CleanupTracking(operation);
            _logger.LogWarning("Operation {OperationId} failed.", operationId);
        };

        operation.StatusChanged += (_, status) =>
        {
            if (status is OperationStatus.Canceled)
            {
                _logStore.UpdateStatus(operationId, "cancelled");
                _queue.Remove(operation);
                CleanupTracking(operation);
                _logger.LogInformation("Operation {OperationId} cancelled.", operationId);
            }
        };
    }

    /// <summary>
    /// Returns the operation ID for a tracked operation, or null if not found.
    /// </summary>
    public string? GetOperationId(AbstractOperation operation)
    {
        lock (_lock)
        {
            return _operationIds.TryGetValue(operation, out string? id) ? id : null;
        }
    }

    /// <summary>
    /// Returns all operations that were pending at last shutdown (for recovery).
    /// </summary>
    public List<OperationRecord> GetPendingOperations()
    {
        return _logStore.GetPendingOperations();
    }

    /// <summary>
    /// Returns log lines for a given operation ID.
    /// </summary>
    public List<LogLineRecord> GetLogLines(string operationId)
    {
        return _logStore.GetLogLines(operationId);
    }

    private void CleanupTracking(AbstractOperation operation)
    {
        lock (_lock)
        {
            _operationIds.Remove(operation);
            _lineCounters.Remove(operation);
        }
    }
}
