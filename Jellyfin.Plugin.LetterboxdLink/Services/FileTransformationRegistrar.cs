using System;
using System.Linq;
using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.LetterboxdLink.Transformations;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.LetterboxdLink.Services;

/// <summary>
/// Registers <see cref="IndexHtmlTransformation"/> with the File
/// Transformation plugin so it can inject our script tag into
/// jellyfin-web's index.html.
/// </summary>
/// <remarks>
/// File Transformation cannot be referenced as a normal NuGet dependency
/// because Jellyfin loads each plugin into its own
/// <see cref="AssemblyLoadContext"/>, so registration happens via
/// reflection instead (this is File Transformation's documented
/// integration method). Plugins are also loaded and started in an
/// unspecified order, so File Transformation may not be loaded yet when
/// this plugin starts. To avoid that startup race this hosted service
/// retries on a timer until registration succeeds or a maximum number of
/// attempts is reached, rather than only trying once.
/// </remarks>
public sealed class FileTransformationRegistrar : IHostedService, IDisposable
{
    private const string FileTransformationAssemblyNameFragment = ".FileTransformation";
    private const string PluginInterfaceTypeName = "Jellyfin.Plugin.FileTransformation.PluginInterface";
    private const string RegisterTransformationMethodName = "RegisterTransformation";

    private static readonly Guid TransformationId = new("122829df-375f-4b62-b5a5-57f87c452680");
    private static readonly TimeSpan RetryInterval = TimeSpan.FromSeconds(5);
    private const int MaxAttempts = 60; // ~5 minutes of retrying before giving up.

    private readonly ILogger<FileTransformationRegistrar> _logger;
    private Timer? _timer;
    private int _attempts;

    /// <summary>
    /// Initializes a new instance of the <see cref="FileTransformationRegistrar"/> class.
    /// </summary>
    /// <param name="logger">Instance of the <see cref="ILogger{TCategoryName}"/> interface.</param>
    public FileTransformationRegistrar(ILogger<FileTransformationRegistrar> logger)
    {
        _logger = logger;
    }

    /// <inheritdoc />
    public Task StartAsync(CancellationToken cancellationToken)
    {
        // Created stopped, then started, so _timer is assigned before the
        // first callback can run. Passing TimeSpan.Zero to the constructor
        // would let the callback fire on a thread pool thread before the
        // assignment completes, leaving it unable to stop the retry loop.
        _timer = new Timer(_ => TryRegister(), null, Timeout.Infinite, Timeout.Infinite);
        _timer.Change(TimeSpan.Zero, RetryInterval);
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task StopAsync(CancellationToken cancellationToken)
    {
        _timer?.Change(Timeout.Infinite, Timeout.Infinite);
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        _timer?.Dispose();
    }

    private void TryRegister()
    {
        int attempt = Interlocked.Increment(ref _attempts);

        bool registered;
        try
        {
            registered = RegisterTransformation();
        }
#pragma warning disable CA1031 // Do not catch general exception types
        catch (Exception ex)
#pragma warning restore CA1031
        {
            // This runs on a timer thread, where an escaping exception would
            // tear down the whole server. Reflecting over another plugin's
            // types can fail in more ways than are worth enumerating (missing
            // dependencies, overload ambiguity, whatever their callback
            // throws), so nothing may get out - a failed attempt just retries.
            _logger.LogWarning(ex, "Failed to register with the File Transformation plugin on attempt {Attempt}.", attempt);
            registered = false;
        }

        if (registered)
        {
            _logger.LogInformation("Registered the Letterboxd Link script with the File Transformation plugin.");
            _timer?.Change(Timeout.Infinite, Timeout.Infinite);
            return;
        }

        if (attempt >= MaxAttempts)
        {
            _logger.LogWarning(
                "File Transformation plugin was not found after {Attempts} attempts. " +
                "Install and enable the File Transformation plugin, then restart Jellyfin, for the Letterboxd link button to appear.",
                attempt);
            _timer?.Change(Timeout.Infinite, Timeout.Infinite);
        }
    }

    private static bool RegisterTransformation()
    {
        Assembly? fileTransformationAssembly = AssemblyLoadContext.All
            .SelectMany(context => context.Assemblies)
            .FirstOrDefault(assembly => assembly.FullName?.Contains(FileTransformationAssemblyNameFragment, StringComparison.Ordinal) ?? false);

        if (fileTransformationAssembly is null)
        {
            return false;
        }

        Type? pluginInterfaceType = fileTransformationAssembly.GetType(PluginInterfaceTypeName);
        MethodInfo? registerMethod = pluginInterfaceType?.GetMethod(RegisterTransformationMethodName);
        if (registerMethod is null)
        {
            return false;
        }

        ParameterInfo[] parameters = registerMethod.GetParameters();
        if (parameters.Length != 1)
        {
            return false;
        }

        // The payload type (Newtonsoft.Json.Linq.JObject) belongs to File
        // Transformation's own assembly. Building an instance of it directly
        // would require our plugin to reference a copy of Newtonsoft.Json
        // that is type-identical to theirs, which isn't guaranteed. Instead
        // we serialize the payload with the BCL's JSON writer and parse it
        // using the target type's own static Parse(string) method, so the
        // instance we hand back to File Transformation is always its type.
        Type payloadType = parameters[0].ParameterType;
        MethodInfo? parseMethod = payloadType.GetMethod("Parse", new[] { typeof(string) });
        if (parseMethod is null)
        {
            return false;
        }

        string payloadJson = JsonSerializer.Serialize(new
        {
            id = TransformationId,
            // An unanchored regex, not a literal: File Transformation matches it
            // against every path jellyfin-web serves. "index.html" would also match
            // e.g. "..._login_index_html.<hash>.chunk.js". The optional leading slash
            // is needed because File Transformation matches the raw request subpath
            // in NeedsTransformation and the slash-trimmed one in RunTransformation.
            fileNamePattern = @"^/?index\.html$",
            callbackAssembly = typeof(IndexHtmlTransformation).Assembly.FullName,
            callbackClass = typeof(IndexHtmlTransformation).FullName,
            callbackMethod = nameof(IndexHtmlTransformation.Inject)
        });

        object? payload = parseMethod.Invoke(null, new object?[] { payloadJson });
        registerMethod.Invoke(null, new object?[] { payload });
        return true;
    }
}
