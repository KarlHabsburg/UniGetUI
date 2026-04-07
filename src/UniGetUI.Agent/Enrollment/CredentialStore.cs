using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using UniGetUI.Core.Data;

namespace UniGetUI.Agent.Enrollment;

/// <summary>
/// Stores and retrieves the agent's machine credential using DPAPI
/// (System.Security.Cryptography.ProtectedData, DataProtectionScope.LocalMachine).
/// This works in a Windows Service context without WinRT APIs.
///
/// Note: This is a deliberate departure from CoreCredentialStore, which uses
/// Windows.Security.Credentials.PasswordVault (WinRT, per-user).
/// DPAPI with LocalMachine scope is accessible to any process running on the machine
/// under the same machine key, which is appropriate for a Windows Service.
/// </summary>
public sealed class CredentialStore
{
    private readonly string _credentialPath;
    private readonly ILogger<CredentialStore> _logger;

    public CredentialStore(ILogger<CredentialStore> logger)
    {
        _credentialPath = Path.Join(CoreData.UniGetUIDataDirectory, "agent-credential.dpapi");
        _logger = logger;
    }

    /// <summary>
    /// Saves the agent credential (UUID + secret) encrypted via DPAPI.
    /// </summary>
    public void Save(AgentCredential credential)
    {
        var json = JsonSerializer.Serialize(credential, SerializationHelpers.DefaultOptions);
        var plainBytes = Encoding.UTF8.GetBytes(json);

        var encryptedBytes = ProtectedData.Protect(
            plainBytes,
            optionalEntropy: null,
            scope: DataProtectionScope.LocalMachine
        );

        var dir = Path.GetDirectoryName(_credentialPath);
        if (dir is not null && !Directory.Exists(dir))
            Directory.CreateDirectory(dir);

        File.WriteAllBytes(_credentialPath, encryptedBytes);
        _logger.LogInformation("Agent credential saved to {Path}", _credentialPath);
    }

    /// <summary>
    /// Loads the agent credential from the DPAPI-encrypted file.
    /// Returns null if no credential exists or decryption fails.
    /// </summary>
    public AgentCredential? Load()
    {
        if (!File.Exists(_credentialPath))
        {
            _logger.LogInformation("No stored credential found at {Path}", _credentialPath);
            return null;
        }

        try
        {
            var encryptedBytes = File.ReadAllBytes(_credentialPath);
            var plainBytes = ProtectedData.Unprotect(
                encryptedBytes,
                optionalEntropy: null,
                scope: DataProtectionScope.LocalMachine
            );

            var json = Encoding.UTF8.GetString(plainBytes);
            var credential = JsonSerializer.Deserialize<AgentCredential>(json, SerializationHelpers.DefaultOptions);
            _logger.LogInformation("Agent credential loaded (agent ID: {AgentId})", credential?.AgentId);
            return credential;
        }
        catch (CryptographicException ex)
        {
            _logger.LogError(ex, "Failed to decrypt agent credential — DPAPI key may have changed");
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load agent credential");
            return null;
        }
    }

    /// <summary>
    /// Deletes the stored credential (used on revocation).
    /// </summary>
    public void Delete()
    {
        if (File.Exists(_credentialPath))
        {
            File.Delete(_credentialPath);
            _logger.LogInformation("Agent credential deleted.");
        }
    }

    public bool HasCredential => File.Exists(_credentialPath);
}

public sealed class AgentCredential
{
    public required string AgentId { get; set; }
    public required string Secret { get; set; }
    public required string DashboardUrl { get; set; }
}
