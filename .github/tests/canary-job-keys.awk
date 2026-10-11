# Prints the value of every job-level `want_key:` of the job `want_job` (its line, as written in
# ci.yml), one per line, so a missing key prints nothing and a repeated key prints twice.
# Run with canary-yaml-key.awk.
$0 == want_job { inside = 1; next }
inside && $0 ~ /^  [A-Za-z]/ { exit }
inside && yaml_key($0, 4) == want_key { print yaml_value($0, 4) }
