const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
const ABSOLUTE_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const UNSAFE_URL_CHARACTERS = /[\\\u0000-\u0020\u007f]/;
const LOCAL_IMAGE_PATH = /^(?:\.{0,2}\/|\/)?[a-zA-Z\d][a-zA-Z\d._~!$&'()*+,;=:@%/-]*(?:\?[a-zA-Z\d._~!$&'()*+,;=:@%/?-]*)?(?:#[a-zA-Z\d._~!$&'()*+,;=:@%/?-]*)?$/;

function cleanUrlValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function safeImageUrl(value) {
  const candidate = cleanUrlValue(value);
  if (!candidate || candidate.startsWith('//') || UNSAFE_URL_CHARACTERS.test(candidate)) return '';

  if (ABSOLUTE_SCHEME.test(candidate)) {
    try {
      const parsed = new URL(candidate);
      return HTTP_PROTOCOLS.has(parsed.protocol) ? parsed.href : '';
    } catch {
      return '';
    }
  }

  return LOCAL_IMAGE_PATH.test(candidate) ? candidate : '';
}

export function safeExternalUrl(value) {
  const candidate = cleanUrlValue(value);
  if (!candidate || UNSAFE_URL_CHARACTERS.test(candidate) || !ABSOLUTE_SCHEME.test(candidate)) return '';

  try {
    const parsed = new URL(candidate);
    return HTTP_PROTOCOLS.has(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

export function setSafeText(element, value) {
  element.textContent = value == null ? '' : String(value);
  return element;
}
