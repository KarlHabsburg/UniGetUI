using UniGetUI.PackageOperations;

namespace UniGetUI.Agent.Operations;

/// <summary>
/// Thread-safe operation queue for the agent. Uses a lock-guarded List
/// (the existing code uses positional operations like IndexOf, Insert, Remove
/// that are incompatible with ConcurrentQueue).
/// The agent creates its own instance rather than using the shared static field.
/// </summary>
public sealed class AgentOperationQueue
{
    private readonly List<AbstractOperation> _queue = [];
    private readonly object _lock = new();

    public int Count
    {
        get { lock (_lock) return _queue.Count; }
    }

    public void Enqueue(AbstractOperation operation)
    {
        lock (_lock)
        {
            if (!_queue.Contains(operation))
                _queue.Add(operation);
        }
    }

    public bool Remove(AbstractOperation operation)
    {
        lock (_lock)
        {
            return _queue.Remove(operation);
        }
    }

    public bool Contains(AbstractOperation operation)
    {
        lock (_lock)
        {
            return _queue.Contains(operation);
        }
    }

    public List<AbstractOperation> GetAll()
    {
        lock (_lock)
        {
            return [.. _queue];
        }
    }

    public void Clear()
    {
        lock (_lock)
        {
            _queue.Clear();
        }
    }
}
