using Jellyfin.Plugin.LetterboxdLink.Transformations;

namespace Jellyfin.Plugin.LetterboxdLink.Tests;

public class IndexHtmlTransformationTests
{
    [Fact]
    public void InjectScriptTag_InsertsBeforeClosingBodyTag()
    {
        const string html = "<html><head></head><body><div>content</div></body></html>";

        string result = IndexHtmlTransformation.InjectScriptTag(html, string.Empty);

        Assert.Contains("<script plugin=\"Jellyfin.Plugin.LetterboxdLink\"", result);
        Assert.True(result.IndexOf("<script", StringComparison.Ordinal) < result.IndexOf("</body>", StringComparison.Ordinal));
        Assert.True(result.IndexOf("<div>content</div>", StringComparison.Ordinal) < result.IndexOf("<script", StringComparison.Ordinal));
    }

    [Fact]
    public void InjectScriptTag_ReferencesScriptRouteWithoutBaseUrl()
    {
        const string html = "<html><body></body></html>";

        string result = IndexHtmlTransformation.InjectScriptTag(html, string.Empty);

        Assert.Contains("src=\"/LetterboxdLink/letterboxd-link.js\"", result);
    }

    [Theory]
    [InlineData("jellyfin")]
    [InlineData("/jellyfin")]
    [InlineData("/jellyfin/")]
    public void InjectScriptTag_PrefixesScriptSrcWithNormalizedBaseUrl(string baseUrl)
    {
        const string html = "<html><body></body></html>";

        string result = IndexHtmlTransformation.InjectScriptTag(html, baseUrl);

        Assert.Contains("src=\"/jellyfin/LetterboxdLink/letterboxd-link.js\"", result);
    }

    [Fact]
    public void InjectScriptTag_IsIdempotent()
    {
        const string html = "<html><body></body></html>";

        string firstPass = IndexHtmlTransformation.InjectScriptTag(html, string.Empty);
        string secondPass = IndexHtmlTransformation.InjectScriptTag(firstPass, string.Empty);

        Assert.Equal(firstPass, secondPass);
        Assert.Equal(2, secondPass.Split("<script").Length); // exactly one occurrence of "<script"
    }

    [Theory]
    [InlineData("<html><body>")]
    [InlineData("\"use strict\";(self.webpackChunk=self.webpackChunk||[]).push([[17244],{}]);")]
    public void InjectScriptTag_LeavesContentWithoutClosingBodyTagUnchanged(string contents)
    {
        string result = IndexHtmlTransformation.InjectScriptTag(contents, string.Empty);

        Assert.Equal(contents, result);
    }

    [Fact]
    public void InjectScriptTag_ThrowsOnNullHtml()
    {
        Assert.Throws<ArgumentNullException>(() => IndexHtmlTransformation.InjectScriptTag(null!, string.Empty));
    }

    [Theory]
    [InlineData("</body>")]
    [InlineData("</BODY>")]
    [InlineData("</Body>")]
    public void InjectScriptTag_MatchesClosingBodyTagCaseInsensitively(string closingTag)
    {
        string html = "<html><body>content" + closingTag + "</html>";

        string result = IndexHtmlTransformation.InjectScriptTag(html, string.Empty);

        Assert.True(result.IndexOf("<script", StringComparison.Ordinal) < result.IndexOf(closingTag, StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void InjectScriptTag_TreatsBlankBaseUrlAsNoPrefix(string baseUrl)
    {
        const string html = "<html><body></body></html>";

        string result = IndexHtmlTransformation.InjectScriptTag(html, baseUrl);

        Assert.Contains("src=\"/LetterboxdLink/letterboxd-link.js\"", result);
    }

    // Inject(payload) is intentionally not unit tested here: it reads
    // Plugin.Instance, and referencing that type is enough for the JIT to
    // try to load Jellyfin server assemblies that are only present next to
    // a real Jellyfin.Server executable (not under `dotnet test`). All of
    // its non-trivial logic lives in InjectScriptTag above, which is
    // covered without touching Plugin.Instance.
}
