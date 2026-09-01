export function boundaryPhraseRegExp(phrase) {
  return new RegExp(phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
}

export function containsPhrase(text, phrase) {
  return boundaryPhraseRegExp(phrase).test(text);
}
