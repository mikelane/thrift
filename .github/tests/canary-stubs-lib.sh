#!/usr/bin/env bash
# Sourced by canary-report-lib.sh. Writes the stub `gh`, `claude` and `tsc` into $STUBS.

# `gh issue list` applies --limit and --jq like the real CLI.
write_gh_stub() {
cat > "$STUBS/gh" <<'EOF'
#!/usr/bin/env bash
echo "gh $*" >> "$GH_CALLS"
case "$1 $2" in
  "api "*)
    [[ -z "${GH_API_FAIL:-}" ]] || exit 1
    cat "$GH_PLUGINS"
    ;;
  "issue list")
    shift 2
    limit=30 jq_filter='.'
    while [[ "$#" -gt 0 ]]; do
      case "$1" in
        --limit) limit=$2; shift ;;
        --jq) jq_filter=$2; shift ;;
      esac
      shift
    done
    [[ -z "${GH_LIST_FAIL:-}" ]] || exit 1
    jq -R '{title: .}' "$GH_OPEN_TITLES" | jq -s --argjson limit "$limit" '.[:$limit]' | jq -r "$jq_filter"
    ;;
  "issue create")
    if grep -qxF -- "$4" "$GH_FAIL_CREATE_TITLES"; then
      echo "stub gh: refusing to create $4" >&2
      exit 1
    fi
    echo "https://github.com/o/r/issues/1"
    ;;
esac
EOF
}

# The stub engine reads its settings from a file beside it, because check.sh runs the declaration
# step under `env -i`, which strips STUB_* from the environment.
write_claude_stub() {
cat > "$STUBS/claude" <<'EOF'
#!/usr/bin/env bash
[[ -f "$(dirname "$0")/stub.env" ]] && . "$(dirname "$0")/stub.env"
echo "claude $*" >> "$STUB_LOG"
is_listed() { [[ " ${1:-} " == *" $2 "* ]]; }
if [[ "${1:-}" = --version ]]; then echo "${STUB_VERSION:-2.1.300} (Claude Code)"; exit 0; fi
if [[ "${1:-}" = -p ]]; then
  plugin_dir=$4
  plugin_name=$(basename "$plugin_dir")
  config_state=missing
  [[ -d "${CLAUDE_CONFIG_DIR:-/nonexistent}" ]] && config_state=empty
  [[ -z "$(ls -A "${CLAUDE_CONFIG_DIR:-/nonexistent}" 2> /dev/null)" ]] || config_state=not-empty
  # Whether each credential is set, never its value: this log is printed when a test fails.
  api_key=unset oauth=unset
  [[ -z "${ANTHROPIC_API_KEY+set}" ]] || api_key=set
  [[ -z "${CLAUDE_CODE_OAUTH_TOKEN+set}" ]] || oauth=set
  echo "GENENV plugin=$plugin_name api_key=$api_key oauth=$oauth config=${CLAUDE_CONFIG_DIR-unset} config_state=$config_state" >> "$STUB_LOG"
  is_listed "${STUB_NO_TYPE_DECLARATIONS:-}" "$plugin_name" || {
    mkdir -p "$plugin_dir/.claude-plugin/types/claude-code"
    : > "$plugin_dir/.claude-plugin/types/claude-code/index.d.ts"
  }
  echo "Not logged in"
  exit 1
fi
plugin_name=$(basename "$3")
if [[ "$2" = validate ]]; then
  is_listed "${STUB_VALIDATE_FAIL:-}" "$plugin_name" && { echo "validate refused $plugin_name"; exit 1; }
  echo ok; exit 0
fi
if [[ "$2" = test ]]; then
  marker_state=absent
  [[ ! -e "${CHECK_LOG_DIR:-/nonexistent}/checked" ]] || marker_state=present
  echo "MARKER plugin=$plugin_name checked=$marker_state" >> "$STUB_LOG"
  is_listed "${STUB_TEST_FAIL:-}" "$plugin_name" && { echo "(fail) a test in $plugin_name"; exit 1; }
  echo "(pass) a test"; exit 0
fi
echo "stub claude: no case for the arguments: $*" >&2
exit 2
EOF
}

write_tsc_stub() {
cat > "$STUBS/tsc" <<'EOF'
#!/usr/bin/env bash
[[ -f "$(dirname "$0")/stub.env" ]] && . "$(dirname "$0")/stub.env"
echo "tsc $*" >> "$STUB_LOG"
plugin_name=$(basename "$2")
if [[ " ${STUB_TSC_FAIL:-} " == *" $plugin_name "* ]]; then
  echo "$2/test/x.ts: error TS2578: Unused '@ts-expect-error' directive."
  exit 2
fi
exit 0
EOF
}

write_stubs() {
  mkdir -p "$STUBS"
  write_gh_stub
  write_claude_stub
  write_tsc_stub
  chmod +x "$STUBS/gh" "$STUBS/claude" "$STUBS/tsc"
}
