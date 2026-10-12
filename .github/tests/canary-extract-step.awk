# The awk program behind extract_step in canary-extract-lib.sh (run with
# canary-yaml-key.awk). The step spec arrives in the
# SPEC environment variable and the step's `- name:` line in the `want` variable.
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
state == 4 { next }
state == 0 { if ($0 == want) state = 1; next }
$0 ~ /^      - / || $0 ~ /^([^ #]|  [^ #])/ { state = 4; next }
state == 2 {
  if ($0 ~ /^ *$/) { print ""; next }
  if (substr($0, 1, 10) == "          ") { print substr($0, 11); next }
  state = 3
}
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
