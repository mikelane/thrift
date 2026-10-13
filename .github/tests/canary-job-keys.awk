# Reads the lines of one job (see canary-job-lines.awk). Prints the value of every job-level
# `want_key:`, one per line, so a missing key prints nothing and a repeated key prints twice.
# Exits 3, with the reason on stderr, when a line continues the value of the key above it, because
# YAML then reads a longer value than the one printed, and when a line is indented less than a job
# key (see is_shallow_stray). Run with canary-yaml-key.awk.
is_shallow_stray($0, 4) && problem == "" { problem = "has a line that is indented less than a job key: " $0 }
continues_scalar($0, 4) && problem == "" { problem = "has a line that continues the value of the key above it: " $0 }
yaml_key($0, 4) == want_key { print yaml_value($0, 4) }
END { if (problem != "") { print problem > "/dev/stderr"; exit 3 } }
