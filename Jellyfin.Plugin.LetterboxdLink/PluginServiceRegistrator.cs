using Jellyfin.Plugin.LetterboxdLink.Services;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.LetterboxdLink;

/// <summary>
/// Registers the plugin's background services with Jellyfin's dependency
/// injection container at server startup.
/// </summary>
public class PluginServiceRegistrator : IPluginServiceRegistrator
{
    /// <inheritdoc />
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddHostedService<FileTransformationRegistrar>();
    }
}
