using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.LetterboxdLink.Configuration;

/// <summary>
/// Plugin configuration. Empty for v1 - the plugin has no user-configurable
/// settings, it only links to a movie's Letterboxd page using its TMDb id.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
}
