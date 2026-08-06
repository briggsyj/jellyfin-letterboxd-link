using System.Reflection;
using Jellyfin.Plugin.LetterboxdLink.Transformations;

namespace Jellyfin.Plugin.LetterboxdLink.Tests;

/// <summary>
/// Guards the client-script embedded resource, whose name
/// (<c>{RootNamespace}.Web.letterboxd-link.js</c>) the controller depends
/// on but nothing checks at compile time - it would break silently if the
/// file were moved/renamed or the project's RootNamespace changed.
/// </summary>
public class EmbeddedResourceTests
{
    private const string ScriptResourceName = "Jellyfin.Plugin.LetterboxdLink.Web.letterboxd-link.js";

    private static Assembly PluginAssembly => typeof(IndexHtmlTransformation).Assembly;

    [Fact]
    public void PluginAssembly_EmbedsTheClientScriptUnderTheExpectedName()
    {
        using Stream? stream = PluginAssembly.GetManifestResourceStream(ScriptResourceName);

        Assert.NotNull(stream);
    }

    [Fact]
    public void EmbeddedClientScript_HasContent()
    {
        using Stream? stream = PluginAssembly.GetManifestResourceStream(ScriptResourceName);
        Assert.NotNull(stream);

        using StreamReader reader = new(stream);
        string contents = reader.ReadToEnd();

        Assert.Contains("letterboxd.com/tmdb/", contents, StringComparison.Ordinal);
    }
}
