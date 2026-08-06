namespace Jellyfin.Plugin.LetterboxdLink.Transformations;

/// <summary>
/// The payload the File Transformation plugin invokes our callback method
/// with. Property name matching against the incoming JSON is
/// case-insensitive, so this only needs a "Contents" property.
/// </summary>
public class IndexHtmlTransformationPayload
{
    /// <summary>
    /// Gets or sets the current contents of the file being transformed.
    /// </summary>
    public string? Contents { get; set; }
}
