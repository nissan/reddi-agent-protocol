# shellcheck shell=bash
# Exact-token version matching shared by the RAP Solana baseline scripts.

version_token_match() {
  local haystack=$1 needle=$2
  local rest=$haystack prefix after before_char after_char offset
  [ -n "$needle" ] || return 1
  while [[ "$rest" == *"$needle"* ]]; do
    prefix=${rest%%"$needle"*}
    offset=$(( ${#prefix} + ${#needle} ))
    after=${rest:offset}
    before_char=${prefix: -1}
    after_char=${after:0:1}
    if [[ ! "$before_char" =~ [0-9A-Za-z._+-] ]] && [[ ! "$after_char" =~ [0-9A-Za-z._+-] ]]; then
      return 0
    fi
    rest=${rest:$(( ${#prefix} + 1 ))}
  done
  return 1
}
