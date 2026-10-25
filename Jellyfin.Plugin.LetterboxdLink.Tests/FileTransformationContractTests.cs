using System.Reflection;
using System.Runtime.Loader;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.LetterboxdLink.Services;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.LetterboxdLink.Tests;

/// <summary>
/// Marks a test that needs a built File Transformation plugin. It is skipped
/// unless <see cref="FileTransformationContractTests.DllEnvironmentVariable"/>
/// points at one, so a plain <c>dotnet test</c> stays self-contained while the
/// compatibility workflow can run the same tests against upcoming versions.
/// </summary>
public sealed class FileTransformationFactAttribute : FactAttribute
{
    public FileTransformationFactAttribute()
    {
        if (string.IsNullOrEmpty(FileTransformationContractTests.DllPath))
        {
            Skip = $"Set {FileTransformationContractTests.DllEnvironmentVariable} to a built Jellyfin.Plugin.FileTransformation.dll to run.";
        }
    }
}

/// <summary>
/// Checks that the registration payload built by
/// <see cref="FileTransformationRegistrar"/> still works against a real
/// File Transformation assembly: the registration method is found, the
/// payload parses into the type it expects, and its own callback pipeline
/// reaches our <c>Inject</c> method and writes the result back. Everything
/// except File Transformation's DI-backed registration and path matching
/// runs for real; the pattern is checked separately below.
/// </summary>
public class FileTransformationContractTests
{
    public const string DllEnvironmentVariable = "FILE_TRANSFORMATION_DLL";

    private const string Html = "<html><head></head><body></body></html>";

    public static string? DllPath => Environment.GetEnvironmentVariable(DllEnvironmentVariable);

    [FileTransformationFact]
    public void RegistrationMethod_IsFoundWithTheShapeWeExpect()
    {
        using FileTransformationContext context = FileTransformationContext.Load(DllPath!);

        MethodInfo? method = FileTransformationRegistrar.FindRegisterMethod(context.Assembly);

        Assert.NotNull(method);
        Assert.True(method.IsStatic);
        Assert.NotNull(FileTransformationRegistrar.CreatePayload(method));
    }

    [FileTransformationFact]
    public void Pattern_MatchesOnlyIndexHtml()
    {
        using FileTransformationContext context = FileTransformationContext.Load(DllPath!);
        object registration = context.BuildRegistration();
        string pattern = (string)registration.GetType().GetProperty("FileNamePattern")!.GetValue(registration)!;

        // File Transformation tests the raw request subpath and the
        // slash-trimmed one, against the same regex.
        Assert.Matches(pattern, "index.html");
        Assert.Matches(pattern, "/index.html");
        Assert.DoesNotMatch(pattern, "assets/login_index_html.abc123.chunk.js");
        Assert.DoesNotMatch(pattern, "index.html.map");
    }

    [FileTransformationFact]
    public async Task Callback_InjectsOurScriptThroughFileTransformationsOwnPipeline()
    {
        using FileTransformationContext context = FileTransformationContext.Load(DllPath!);
        object registration = context.BuildRegistration();

        using var stream = new MemoryStream();
        using (var writer = new StreamWriter(stream, leaveOpen: true))
        {
            writer.Write(Html);
        }

        // File Transformation reads from the current position; its middleware rewinds first.
        stream.Position = 0;

        var logger = new CapturingLogger();
        await context.ApplyTransformation("index.html", stream, registration, logger);

        stream.Position = 0;
        string result = new StreamReader(stream).ReadToEnd();

        // File Transformation logs and swallows callback failures, so surface
        // what it said if our script did not make it into the output.
        string because = $"File Transformation logged: {string.Join(" | ", logger.Messages)}";
        Assert.True(result.Contains("Jellyfin.Plugin.LetterboxdLink", StringComparison.Ordinal), because);
        Assert.Contains("<script", result, StringComparison.Ordinal);
    }

    private sealed class CapturingLogger : ILogger
    {
        public List<string> Messages { get; } = new();

        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            Messages.Add($"[{logLevel}] {formatter(state, exception)}{(exception is null ? string.Empty : " " + (exception.InnerException ?? exception))}");
        }
    }

    /// <summary>
    /// Loads File Transformation into its own context so its Newtonsoft.Json
    /// stays separate from ours, as it is under Jellyfin, while sharing the
    /// host's copies of everything else (so logger types line up).
    /// </summary>
    private sealed class FileTransformationContext : AssemblyLoadContext, IDisposable
    {
        private readonly AssemblyDependencyResolver _resolver;

        private FileTransformationContext(string dllPath)
            : base("FileTransformationUnderTest", isCollectible: true)
        {
            _resolver = new AssemblyDependencyResolver(dllPath);
            Assembly = LoadFromAssemblyPath(dllPath);
        }

        public Assembly Assembly { get; }

        public static FileTransformationContext Load(string dllPath) => new(Path.GetFullPath(dllPath));

        public object BuildRegistration()
        {
            MethodInfo registerMethod = FileTransformationRegistrar.FindRegisterMethod(Assembly)
                ?? throw new InvalidOperationException("Registration method not found.");
            object jObject = FileTransformationRegistrar.CreatePayload(registerMethod)
                ?? throw new InvalidOperationException("Payload could not be built.");

            // Same conversion PluginInterface.RegisterTransformation does.
            Type registrationType = Assembly.GetType("Jellyfin.Plugin.FileTransformation.Models.TransformationRegistrationPayload")
                ?? throw new InvalidOperationException("Registration payload type not found.");
            MethodInfo toObject = jObject.GetType().GetMethod("ToObject", new[] { typeof(Type) })
                ?? throw new InvalidOperationException("JObject.ToObject(Type) not found.");
            return toObject.Invoke(jObject, new object[] { registrationType })
                ?? throw new InvalidOperationException("Payload did not convert.");
        }

        public Task ApplyTransformation(string path, Stream contents, object registration, ILogger logger)
        {
            Type helper = Assembly.GetType("Jellyfin.Plugin.FileTransformation.Helpers.TransformationHelper")
                ?? throw new InvalidOperationException("TransformationHelper not found.");
            MethodInfo apply = helper.GetMethod("ApplyTransformation")
                ?? throw new InvalidOperationException("ApplyTransformation not found.");

            // The server host is only used by the HTTP-endpoint callback tier.
            return (Task)apply.Invoke(null, new object?[] { path, contents, registration, logger, null })!;
        }

        void IDisposable.Dispose() => Unload();

        protected override Assembly? Load(AssemblyName assemblyName)
        {
            // Only Newtonsoft.Json is kept private; everything else comes from the host.
            if (assemblyName.Name == "Newtonsoft.Json" && _resolver.ResolveAssemblyToPath(assemblyName) is { } path)
            {
                return LoadFromAssemblyPath(path);
            }

            try
            {
                return Default.LoadFromAssemblyName(assemblyName);
            }
            catch (FileNotFoundException)
            {
                string? fallback = _resolver.ResolveAssemblyToPath(assemblyName);
                return fallback is null ? null : LoadFromAssemblyPath(fallback);
            }
        }
    }
}
