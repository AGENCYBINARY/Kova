const conversationalLeadInPattern =
  /^(?:(?:bonjour|salut|hello|hey|yo|coucou|bonsoir)(?:\s+(?:boss|bro|frero|frerot|frérot|kova))?(?:[,.!?\s]+(?:ca va|ça va|tu vas bien|comment ca va|comment ça va))?|(?:boss|bro|frero|frerot|frérot|kova))(?:[,.!:\-\s]+)*/i

export function stripConversationalLeadIn(input: string) {
  const trimmed = input.trim()
  if (!trimmed) {
    return trimmed
  }

  let stripped = trimmed.replace(conversationalLeadInPattern, '').trim()
  stripped = stripped.replace(/^(?:plus|et|alors|du coup)\s+/i, '').trim()

  if (!stripped) {
    return trimmed
  }

  if (stripped.split(/\s+/).length < 3 && !/[?]/.test(stripped)) {
    return trimmed
  }

  return stripped
}
