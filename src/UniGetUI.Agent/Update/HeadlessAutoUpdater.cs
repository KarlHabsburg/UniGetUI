using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace UniGetUI.Agent.Update;

/// <summary>
/// Headless auto-updater for the agent. Extracts the update protocol from the
/// existing AutoUpdater (fetch productinfo.json, compare versions, download,
/// verify SHA-256 hash + Authenticode signature) without any GUI dependencies.
///
/// The dashboard hosts the update manifest at a known URL. The agent verifies
/// the installer against a signing certificate thumbprint pinned at enrollment.
/// </summary>
public sealed class HeadlessAutoUpdater
{
    private readonly ILogger<HeadlessAutoUpdater> _logger;
    private readonly string _updateUrl;
    private readonly string? _pinnedThumbprint;
    private readonly string _stagingDir;

    public HeadlessAutoUpdater(
        string updateUrl,
        string? pinnedThumbprint,
        ILogger<HeadlessAutoUpdater> logger)
    {
        _updateUrl = updateUrl;
        _pinnedThumbprint = pinnedThumbprint;
        _logger = logger;
        _stagingDir = Path.Join(Path.GetTempPath(), "UniGetUI-Agent-Update");
    }

    /// <summary>
    /// Check for updates and apply if available. Returns true if an update was applied.
    /// </summary>
    public async Task<bool> CheckAndApplyAsync(string currentVersion, CancellationToken ct = default)
    {
        _logger.LogInformation("Checking for updates at {Url}...", _updateUrl);

        using var httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };

        // Fetch product info
        ProductInfo? productInfo;
        try
        {
            var response = await httpClient.GetStringAsync(_updateUrl, ct);
            productInfo = JsonSerializer.Deserialize<ProductInfo>(response);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to fetch update manifest");
            return false;
        }

        if (productInfo is null || string.IsNullOrEmpty(productInfo.Version))
        {
            _logger.LogInformation("No update information available.");
            return false;
        }

        // Compare versions
        if (!IsNewer(currentVersion, productInfo.Version))
        {
            _logger.LogInformation("Agent is up to date (current: {Current}, latest: {Latest})",
                currentVersion, productInfo.Version);
            return false;
        }

        _logger.LogInformation("Update available: {Current} → {New}", currentVersion, productInfo.Version);

        if (string.IsNullOrEmpty(productInfo.InstallerUrl))
        {
            _logger.LogWarning("Update manifest has no installer URL");
            return false;
        }

        // Download installer
        Directory.CreateDirectory(_stagingDir);
        string installerPath = Path.Join(_stagingDir, $"UniGetUI-Agent-{productInfo.Version}.exe");

        try
        {
            _logger.LogInformation("Downloading installer...");
            var installerBytes = await httpClient.GetByteArrayAsync(productInfo.InstallerUrl, ct);
            await File.WriteAllBytesAsync(installerPath, installerBytes, ct);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to download installer");
            return false;
        }

        // Verify SHA-256 hash
        if (!string.IsNullOrEmpty(productInfo.InstallerHash))
        {
            var actualHash = ComputeSha256(installerPath);
            if (!actualHash.Equals(productInfo.InstallerHash, StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogError("Hash mismatch! Expected: {Expected}, Got: {Actual}",
                    productInfo.InstallerHash, actualHash);
                File.Delete(installerPath);
                return false;
            }
            _logger.LogInformation("Installer hash verified.");
        }

        // Verify Authenticode signature thumbprint (if pinned)
        if (_pinnedThumbprint is not null)
        {
            if (!VerifySignerThumbprint(installerPath, _pinnedThumbprint))
            {
                _logger.LogError("Installer signer thumbprint does not match pinned value");
                File.Delete(installerPath);
                return false;
            }
            _logger.LogInformation("Installer signature verified.");
        }

        // Apply update — launch installer and request service restart
        _logger.LogInformation("Applying update...");
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = installerPath,
                Arguments = "/SILENT /RESTARTSERVICE",
                UseShellExecute = false,
            });
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to launch installer");
            return false;
        }
    }

    private static string ComputeSha256(string filePath)
    {
        using var stream = File.OpenRead(filePath);
        var hash = SHA256.HashData(stream);
        return Convert.ToHexString(hash);
    }

    private static bool VerifySignerThumbprint(string filePath, string expectedThumbprint)
    {
        try
        {
            var cert = System.Security.Cryptography.X509Certificates.X509Certificate.CreateFromSignedFile(filePath);
            using var cert2 = new System.Security.Cryptography.X509Certificates.X509Certificate2(cert);
            return cert2.Thumbprint.Equals(expectedThumbprint, StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private static bool IsNewer(string current, string latest)
    {
        if (Version.TryParse(current, out var currentVer) && Version.TryParse(latest, out var latestVer))
            return latestVer > currentVer;
        return string.Compare(latest, current, StringComparison.OrdinalIgnoreCase) > 0;
    }

    private sealed class ProductInfo
    {
        public string Version { get; set; } = "";
        public string? InstallerUrl { get; set; }
        public string? InstallerHash { get; set; }
    }
}
