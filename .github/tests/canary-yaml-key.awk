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

# Whether the `key:` line at `indent` starts a plain or quoted scalar, which a more indented line
# after it would continue. An empty value (a mapping or sequence follows), a comment and a block
# scalar indicator (`|`, `>-`, `|2`) do not.
function opens_scalar(line, indent,    value) {
  if (yaml_key(line, indent) == "") return 0
  value = yaml_value(line, indent)
  return !(value == "" || value ~ /^#/ || value ~ /^[|>][-+0-9]*( +#.*)?$/)
}

# Feed every line of a region to this, in order. Returns 1 for a line that continues the scalar of
# the `key:` line at `indent` above it: not blank, not a comment, indented deeper than that key.
# YAML reads such a line as part of the key's value, and the harness reads only the first line.
function continues_scalar(line, indent,    line_indent, continues) {
  if (line ~ /^ *$/ || line ~ /^ *#/) return 0
  line_indent = match(line, /[^ ]/) - 1
  continues = scalar_is_open && line_indent > indent
  scalar_is_open = !continues && opens_scalar(line, indent)
  return continues
}
