/** Shared literal skill detection. Vocabulary changes require a new version and reprocessing. */
const word = /[\p{L}\p{N}_]/u;

function isWordAt(text, index) {
  if (index < 0 || index >= text.length) return false;
  // Work with Unicode code points at either side of a UTF-16 offset.
  const code = text.codePointAt(index);
  return code !== undefined && word.test(String.fromCodePoint(code));
}

function previousCodePointStart(text, index) {
  if (index <= 0) return -1;
  const previous = text.charCodeAt(index - 1);
  return previous >= 0xdc00 && previous <= 0xdfff && index >= 2 ? index - 2 : index - 1;
}

export function detectSkills(text, vocabulary) {
  if (typeof text !== 'string' || !vocabulary || !Array.isArray(vocabulary.skills)) {
    throw new TypeError('Expected text and a skill vocabulary');
  }
  const haystack = text.normalize('NFKC').toLocaleLowerCase('en-US');
  const found = [];
  for (const skill of vocabulary.skills) {
    const matches = skill.aliases.some(alias => {
      const needle = alias.normalize('NFKC').toLocaleLowerCase('en-US');
      if (!needle) return false;
      let start = 0;
      while ((start = haystack.indexOf(needle, start)) !== -1) {
        const end = start + needle.length;
        // Always require boundaries, including for aliases ending in punctuation such as C++.
        if (!isWordAt(haystack, previousCodePointStart(haystack, start)) && !isWordAt(haystack, end)) return true;
        start += needle.length;
      }
      return false;
    });
    if (matches) found.push(skill.id);
  }
  return found;
}
