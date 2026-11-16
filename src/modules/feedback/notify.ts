// Tells Anwar about new feedback through his Telegram bot (osbot). Optional:
// without OSBOT_TOKEN and OSBOT_OWNER_CHAT_ID it does nothing. It never
// throws and gives up after 3 seconds, so a Telegram outage can't break or
// slow down a submission (callers also run it after the response via after()).

export type NotifyOptions = {
  timeoutMs?: number
  fetchImpl?: typeof fetch
  env?: { OSBOT_TOKEN?: string; OSBOT_OWNER_CHAT_ID?: string }
}

/** Returns true if Telegram accepted the message, false otherwise (including "not configured"). */
export async function notifyOwner(text: string, options: NotifyOptions = {}): Promise<boolean> {
  const { timeoutMs = 3_000, fetchImpl = fetch, env = process.env } = options
  const token = env.OSBOT_TOKEN?.trim()
  const chatId = env.OSBOT_OWNER_CHAT_ID?.trim()
  if (!token || !chatId) return false

  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Plain text (no parse_mode): visitor input can't break or inject formatting.
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4096),
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    })
    return response.ok
  } catch {
    return false
  }
}
