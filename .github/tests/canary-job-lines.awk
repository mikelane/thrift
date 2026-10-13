# Prints the lines of one job of ci.yml, after its header, which is `want_job` as written in ci.yml.
# The job ends at the next line at indent 0 or 2 that is not blank and not a comment, whatever the
# next job is called. Every reader of a job's lines goes through here, so they agree on where a job
# ends, and a line inside a comment never counts as part of the job's steps.
# Exits 3, with the reason on stderr, when such a line is not a key line (a job id, or a top-level
# key, followed by a colon): it could be the tail of a value that started inside the job, so it must
# not quietly end the job.
function is_key_line(line) {
  return line ~ /^([A-Za-z_][A-Za-z0-9_-]*|"[^"]+"|'[^']+') *:/ || line ~ /^  ([A-Za-z_][A-Za-z0-9_-]*|"[^"]+"|'[^']+') *:/
}
$0 == want_job { is_in_job = 1; next }
is_in_job && $0 ~ /^([^ #]|  [^ #])/ {
  if (!is_key_line($0)) { print "has a line at indent 0 or 2 that is not a key line: " $0 > "/dev/stderr"; exit 3 }
  exit
}
is_in_job
