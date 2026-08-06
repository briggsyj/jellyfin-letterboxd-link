using System.IO;
using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.LetterboxdLink.Controllers;

/// <summary>
/// Serves the client script injected into jellyfin-web's index.html.
/// </summary>
[ApiController]
[Route("LetterboxdLink")]
public class LetterboxdLinkController : ControllerBase
{
    // The [Route] + [HttpGet] path below must resolve to the same URL as
    // IndexHtmlTransformation.ScriptRoute, since that is what gets written
    // into the injected <script src>. This resource name must likewise match
    // the <EmbeddedResource> in the .csproj (root namespace + "Web" folder +
    // file name). Neither coupling is checked at compile time, so keep them
    // in sync by hand if the route or file location ever changes.
    private const string EmbeddedScriptResourceName = "Jellyfin.Plugin.LetterboxdLink.Web.letterboxd-link.js";

    /// <summary>
    /// Returns the client script. Anonymous access is required since the
    /// browser requests this via a plain &lt;script src&gt; tag with no
    /// authentication headers attached, including on the login page.
    /// </summary>
    /// <returns>The script contents.</returns>
    [HttpGet("letterboxd-link.js")]
    [AllowAnonymous]
    [Produces("application/javascript")]
    public ActionResult GetScript()
    {
        Stream? stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(EmbeddedScriptResourceName);
        if (stream is null)
        {
            return NotFound();
        }

        return File(stream, "application/javascript");
    }
}
