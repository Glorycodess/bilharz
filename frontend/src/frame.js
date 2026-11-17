// Whether Bilharz is shown inside another page, such as the Space's page on
// huggingface.co. There, the session cookie belongs to another site than the
// page around it, and browsers do not send it (SameSite=Lax, and third-party
// cookies blocked), so signing in only works in Bilharz's own tab.
export function inFrame() {
  try {
    return window.self !== window.top
  } catch {
    // Reading window.top of another site can throw: that is a frame too.
    return true
  }
}

// A path within Bilharz, for "?next=": only one that starts with a single "/",
// so a link can never send someone on to another site after signing in.
export function safeNext(value, fallback = '/queue') {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')
    ? value
    : fallback
}
