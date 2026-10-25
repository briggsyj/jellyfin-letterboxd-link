#!/usr/bin/env bash
# Checks the plugin against the newest stable and upcoming versions of the
# two things it depends on at runtime: Jellyfin (via its NuGet packages) and
# the File Transformation plugin (built from source). Used by
# .github/workflows/upcoming-compat.yml, and runnable locally from the repo
# root:  .github/scripts/check-upcoming.sh [output-dir]
#
# Writes <output-dir>/report.md (Markdown summary), <output-dir>/failed (only
# if something failed) and one log per check. Always exits 0 once it has
# produced a report; callers decide what a failure means.

set -uo pipefail

out="$(realpath -m "${1:-compat-out}")"
work="$out/work"
repo_root="$(pwd)"
ft_repo="${FT_REPO:-https://github.com/IAmParadox27/jellyfin-plugin-file-transformation}"

rm -rf "$out"
mkdir -p "$work"

jellyfin_rows="$out/jellyfin.tsv"
ft_rows="$out/file-transformation.tsv"
: > "$jellyfin_rows"
: > "$ft_rows"

# Highest of the given versions by numeric components.
latest() { sort -V | tail -n1; }

# --- Resolve versions -------------------------------------------------------

nuget_versions=$(curl -fsS https://api.nuget.org/v3-flatcontainer/jellyfin.controller/index.json | jq -r '.versions[]')
jellyfin_stable=$(grep -v -- '-' <<<"$nuget_versions" | latest)
# Newest pre-release whose base version is ahead of the latest stable.
jellyfin_pre=$(grep -- '-' <<<"$nuget_versions" | while read -r v; do
    base="${v%%-*}"
    if [ "$base" != "$jellyfin_stable" ] && [ "$(printf '%s\n%s\n' "$jellyfin_stable" "$base" | latest)" = "$base" ]; then
        echo "$v"
    fi
done | latest || true)

ft_refs=$(git ls-remote --tags "$ft_repo")
# Prefer the peeled commit of annotated tags (refs/tags/x^{}) over the tag object.
ft_tag_lines=$(awk '{sub("refs/tags/","",$2); print}' <<<"$ft_refs" | grep -E ' [0-9]+(\.[0-9]+)+(\^\{\})?$' || true)
ft_stable=$(awk '{print $2}' <<<"$ft_tag_lines" | sed 's/\^{}$//' | sort -u | latest)
ft_stable_commit=$(awk -v t="$ft_stable" '$2 == t"^{}" {print $1}' <<<"$ft_tag_lines")
[ -n "$ft_stable_commit" ] || ft_stable_commit=$(awk -v t="$ft_stable" '$2 == t {print $1}' <<<"$ft_tag_lines")

if [ -z "$jellyfin_stable" ] || [ -z "$ft_stable" ] || [ -z "$ft_stable_commit" ]; then
    echo "Could not resolve versions (jellyfin='$jellyfin_stable', file-transformation='$ft_stable'); not reporting." >&2
    exit 1
fi

# Upcoming File Transformation work: the default branch and any vNN branches
# (it has developed support for new Jellyfin majors on those) that are ahead
# of the latest tag.
ft_upcoming=$(git ls-remote --heads "$ft_repo" | awk '{sub("refs/heads/","",$2); print $1, $2}' |
    awk -v stable="$ft_stable_commit" '$2 ~ /^(main|master|v[0-9]+(\.[0-9]+)*)$/ && $1 != stable {print $2, $1}')

echo "Jellyfin: stable=$jellyfin_stable pre=${jellyfin_pre:-none}"
echo "File Transformation: stable=$ft_stable ($ft_stable_commit) upcoming=${ft_upcoming:-none}"

# --- Run checks -------------------------------------------------------------

record() { printf '%s\t%s\t%s\t%s\n' "$2" "$3" "$4" "$5" >> "$1"; }

check_jellyfin() {
    local channel="$1" version="$2" log="$out/jellyfin-$2.log" prop="-p:JellyfinVersion=$2"
    echo "::group::Jellyfin $version ($channel)"
    if dotnet restore "$prop" >"$log" 2>&1 &&
        dotnet build --no-restore -c Release "$prop" >>"$log" 2>&1 &&
        dotnet test --no-build -c Release "$prop" >>"$log" 2>&1; then
        record "$jellyfin_rows" "$channel" "$version" pass "$log"
    else
        record "$jellyfin_rows" "$channel" "$version" fail "$log"
    fi
    tail -n 15 "$log"
    echo "::endgroup::"
}

check_file_transformation() {
    local channel="$1" ref="$2" label="$3" dir log
    dir="$work/ft-$label"
    log="$out/file-transformation-$label.log"
    echo "::group::File Transformation $ref ($channel)"
    local commit="?"
    if git clone -q --depth 1 --branch "$ref" "$ft_repo" "$dir" >"$log" 2>&1; then
        commit=$(git -C "$dir" rev-parse --short HEAD)
    fi
    # The dll is built with its dependencies alongside so the test can load it
    # the way Jellyfin does (its own Newtonsoft.Json, host copies of the rest).
    # Skipped tests count as failures: a skip means nothing was verified.
    if [ "$commit" != "?" ] &&
        dotnet build "$dir/src/Jellyfin.Plugin.FileTransformation" -c Release \
            -p:CopyLocalLockFileAssemblies=true -o "$dir/out" >>"$log" 2>&1 &&
        FILE_TRANSFORMATION_DLL="$dir/out/Jellyfin.Plugin.FileTransformation.dll" \
            dotnet test -c Release --filter "FullyQualifiedName~FileTransformationContract" \
            >>"$log" 2>&1 &&
        grep -Eq 'Passed!.*Passed: +[1-9]' "$log" && ! grep -Eq 'Skipped: +[1-9]' "$log"; then
        record "$ft_rows" "$channel" "$ref ($commit)" pass "$log"
    else
        record "$ft_rows" "$channel" "$ref ($commit)" fail "$log"
    fi
    tail -n 15 "$log"
    echo "::endgroup::"
}

cd "$repo_root" || exit 1

check_jellyfin stable "$jellyfin_stable"
[ -z "$jellyfin_pre" ] || check_jellyfin unstable "$jellyfin_pre"

# Restore the default Jellyfin version before the File Transformation checks,
# which test against what the repo currently targets.
dotnet restore >/dev/null 2>&1 && dotnet build --no-restore -c Release >/dev/null 2>&1

check_file_transformation stable "$ft_stable" stable
while read -r ref _; do
    [ -n "$ref" ] && check_file_transformation unstable "$ref" "$ref"
done <<<"$ft_upcoming"

# --- Report -----------------------------------------------------------------

mark() { [ "$1" = pass ] && echo "✅ pass" || echo "❌ fail"; }

{
    echo "Checked on $(date -u +%Y-%m-%d) against \`${GITHUB_REPOSITORY:-local}\` @ \`$(git rev-parse --short HEAD)\`."
    echo
    echo "### Jellyfin (build and tests against its NuGet packages)"
    echo
    echo "| Channel | Version | Result |"
    echo "| --- | --- | --- |"
    while IFS=$'\t' read -r channel version result _; do
        echo "| $channel | $version | $(mark "$result") |"
    done < "$jellyfin_rows"
    echo
    echo "### File Transformation (built from source, contract tests)"
    echo
    echo "| Channel | Ref | Result |"
    echo "| --- | --- | --- |"
    while IFS=$'\t' read -r channel ref result _; do
        echo "| $channel | $ref | $(mark "$result") |"
    done < "$ft_rows"
    [ -n "$ft_upcoming" ] || echo "| unstable | _nothing ahead of ${ft_stable}_ | – |"
} > "$out/report.md"

if grep -q $'\tfail\t' "$jellyfin_rows" "$ft_rows"; then
    : > "$out/failed"
    {
        echo
        echo "### Failure details (last lines of each log)"
        for rows in "$jellyfin_rows" "$ft_rows"; do
            while IFS=$'\t' read -r channel ref result log; do
                [ "$result" = fail ] || continue
                echo
                echo "<details><summary>$channel $ref</summary>"
                echo
                echo '```'
                tail -n 40 "$log" | cut -c1-300
                echo '```'
                echo
                echo "</details>"
            done < "$rows"
        done
    } >> "$out/report.md"
fi

cat "$out/report.md"
exit 0
