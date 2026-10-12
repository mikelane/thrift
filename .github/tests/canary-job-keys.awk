# Reads the lines of one job (see canary-job-lines.awk). Prints the value of every job-level
# `want_key:`, one per line, so a missing key prints nothing and a repeated key prints twice.
# Run with canary-yaml-key.awk.
yaml_key($0, 4) == want_key { print yaml_value($0, 4) }
