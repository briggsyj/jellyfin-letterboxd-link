using System;
using Jellyfin.Plugin.LetterboxdLink.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Controller.Configuration;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.LetterboxdLink;

/// <summary>
/// The main plugin entry point. Registers no configuration page and no
/// dashboard UI - all of the plugin's behaviour is a single injected script
/// served by <see cref="Controllers.LetterboxdLinkController"/>.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>
{
    /// <summary>
    /// Initializes a new instance of the <see cref="Plugin"/> class.
    /// </summary>
    /// <param name="applicationPaths">Instance of the <see cref="IApplicationPaths"/> interface.</param>
    /// <param name="xmlSerializer">Instance of the <see cref="IXmlSerializer"/> interface.</param>
    /// <param name="serverConfigurationManager">Instance of the <see cref="IServerConfigurationManager"/> interface.</param>
    public Plugin(
        IApplicationPaths applicationPaths,
        IXmlSerializer xmlSerializer,
        IServerConfigurationManager serverConfigurationManager)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
        ServerConfigurationManager = serverConfigurationManager;
    }

    /// <inheritdoc />
    public override string Name => "Letterboxd Link";

    /// <inheritdoc />
    public override Guid Id => Guid.Parse("81fd3f59-6723-456e-9224-084444970919");

    /// <inheritdoc />
    public override string Description =>
        "Adds a button to each movie's detail page that opens the film's Letterboxd page.";

    /// <summary>
    /// Gets the current plugin instance.
    /// </summary>
    public static Plugin? Instance { get; private set; }

    /// <summary>
    /// Gets the server configuration manager, used to resolve the server's
    /// base URL when building the injected script tag.
    /// </summary>
    internal IServerConfigurationManager ServerConfigurationManager { get; }
}
