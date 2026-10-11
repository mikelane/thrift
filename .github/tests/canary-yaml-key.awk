# Helpers for the awk programs that read keys out of ci.yml. YAML reads `if`, `"if"`, `'if'` and
# `if :` as the same key, so the harness has to as well.

# The key on a line indented exactly `indent` spaces, without quotes or the space before the colon.
# Empty when the line is not a `key:` line at that indent.
function yaml_key(line, indent,    rest, colon, name) {
  if (substr(line, 1, indent) != sprintf("%" indent "s", "")) return ""
  rest = substr(line, indent + 1)
  colon = index(rest, ":")
  if (colon == 0 || rest ~ /^ /) return ""
  name = substr(rest, 1, colon - 1)
  sub(/ +$/, "", name)
  if (name ~ /^".+"$/ || name ~ /^'.+'$/) name = substr(name, 2, length(name) - 2)
  return (name ~ /^[A-Za-z_-]+$/) ? name : ""
}

# What follows the colon of a `key:` line, without the spaces after it.
function yaml_value(line, indent,    rest, value) {
  rest = substr(line, indent + 1)
  value = substr(rest, index(rest, ":") + 1)
  sub(/^ +/, "", value)
  return value
}
