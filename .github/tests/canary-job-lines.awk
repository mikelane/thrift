# Prints the lines of one job of ci.yml, after its header, which is `want_job` as written in ci.yml.
# The job ends at the next line at indent 0 or 2 that is not blank and not a comment, whatever the
# next job is called. Every reader of a job's lines goes through here, so they agree on where a job
# ends, and a line inside a comment never counts as part of the job's steps.
$0 == want_job { inside = 1; next }
inside && $0 ~ /^([^ #]|  [^ #])/ { exit }
inside
