using System;
using System.Globalization;
using MediaBrowser.Common.Net;

namespace Jellyfin.Plugin.LetterboxdLink.Transformations;

/// <summary>
/// Injects a &lt;script&gt; tag referencing our client script into
/// jellyfin-web's index.html. Invoked by the File Transformation plugin via
/// reflection - see <see cref="Services.FileTransformationRegistrar"/>.
/// </summary>
public static class IndexHtmlTransformation
{
    /// <summary>
    /// Marker string written into the injected tag. Used to detect an
    /// already-transformed file so repeated calls stay idempotent.
    /// </summary>
    public const string ScriptPluginAttribute = "Jellyfin.Plugin.LetterboxdLink";

    /// <summary>
    /// The route, relative to the server base URL, that serves the client script.
    /// </summary>
    public const string ScriptRoute = "/LetterboxdLink/letterboxd-link.js";

    /// <summary>
    /// Callback invoked by the File Transformation plugin.
    /// </summary>
    /// <param name="payload">Payload from the File Transformation plugin, wrapping index.html's current contents.</param>
    /// <returns>The (possibly modified) contents of index.html.</returns>
    public static string Inject(IndexHtmlTransformationPayload payload)
    {
        ArgumentNullException.ThrowIfNull(payload);

        string baseUrl = Plugin.Instance?.ServerConfigurationManager
            .GetNetworkConfiguration().BaseUrl ?? string.Empty;

        return InjectScriptTag(payload.Contents ?? string.Empty, baseUrl);
    }

    /// <summary>
    /// Pure string-manipulation core of the transformation, kept separate
    /// from <see cref="Inject"/> so it can be unit tested without a running
    /// Jellyfin server.
    /// </summary>
    /// <param name="html">The HTML document to inject the script tag into.</param>
    /// <param name="baseUrl">The server's configured base URL (path prefix), if any.</param>
    /// <returns>The HTML document with the script tag injected.</returns>
    public static string InjectScriptTag(string html, string baseUrl)
    {
        ArgumentNullException.ThrowIfNull(html);

        if (html.Contains(ScriptPluginAttribute, StringComparison.Ordinal))
        {
            // Already injected - avoid duplicating the tag if this callback
            // is ever invoked more than once for the same content.
            return html;
        }

        string normalizedBaseUrl = string.IsNullOrWhiteSpace(baseUrl)
            ? string.Empty
            : "/" + baseUrl.Trim('/');

        string scriptTag = string.Format(
            CultureInfo.InvariantCulture,
            "<script plugin=\"{0}\" src=\"{1}{2}\" defer></script>",
            ScriptPluginAttribute,
            normalizedBaseUrl,
            ScriptRoute);

        int bodyCloseIndex = html.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
        return bodyCloseIndex < 0
            ? html + scriptTag
            : html.Insert(bodyCloseIndex, scriptTag);
    }
}
