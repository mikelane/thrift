# The awk program behind extract_step in canary-extract-lib.sh. Run it after canary-yaml-key.awk.
# Reads ci.yml. Prints the de-indented `run:` body of the step whose `- name:` line is `want`, and
# prints nothing when no such step has a run block. Exits 3, with the reason on stderr, when the
# step has a key the spec does not allow, a key with the wrong value, or lacks a required key, and
# when a line at key indentation is not blank, not a comment, and not a plain `key:` yaml_key can
# name (a quoted escape, a tab before the colon, `? key`), because it could be any key at all, and
# when a line continues the value of the key above it (see continues_scalar).
# The spec arrives in the SPEC environment variable, one entry per line (see extract_step).
BEGIN {
  count = split(ENVIRON["SPEC"], entries, "\n")
  for (i = 1; i <= count; i++) {
    entry = entries[i]
    if (entry == "") continue
    required = (substr(entry, 1, 1) == "+")
    if (required) entry = substr(entry, 2)
    eq = index(entry, "=")
    key = eq ? substr(entry, 1, eq - 1) : entry
    if (eq) value[key] = substr(entry, eq + 1)
    allowed[key] = 1
    if (required) needed[key] = 1
  }
  allowed["run"] = 1
  state = 0
}
function check_key(key) {
  seen[key] = 1
  if (!(key in allowed)) problem = "has the key \"" key "\", which the harness does not model"
  else if ((key in value) && yaml_value($0, 8) != value[key]) problem = "has \"" key "\" set to something other than \"" value[key] "\""
}
function check_line() {
  if (problem == "") problem = "has a line the harness cannot read as a plain key: " $0
}
state == 4 { next }
state == 0 { if ($0 == want) state = 1; next }
$0 ~ /^      - / || $0 ~ /^([^ #]|  [^ #])/ { state = 4; next }
state == 2 {
  if ($0 ~ /^ *$/) { print ""; next }
  if (substr($0, 1, 10) == "          ") { print substr($0, 11); next }
  state = 3
}
state >= 1 && continues_scalar($0, 8) && problem == "" { problem = "has a line that continues the value of the key above it: " $0 }
state >= 1 && $0 ~ /^        [^ #]/ && yaml_key($0, 8) == "" { check_line() }
yaml_key($0, 8) != "" {
  check_key(yaml_key($0, 8))
  if (state == 1 && $0 == "        run: |") state = 2
  else if (state == 1 && index($0, "        run: ") == 1) { print substr($0, 14); state = 3 }
}
END {
  if (state == 0) exit
  if (problem == "") for (key in needed) if (!(key in seen)) problem = "lacks the key \"" key "\""
  if (problem != "") { print problem > "/dev/stderr"; exit 3 }
}
