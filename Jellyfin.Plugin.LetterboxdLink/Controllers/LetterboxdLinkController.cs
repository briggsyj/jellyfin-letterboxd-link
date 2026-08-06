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
