# iPhone Shortcuts for anwar.os

Three shortcuts that talk to anwar.os from the iPhone, the Home Screen and Siri:

| Shortcut | Say | Does | Token |
|---|---|---|---|
| **Add expense** | "Hey Siri, add expense" | asks "250 coffee" → a Budget expense | read and write |
| **Capture** | "Hey Siri, capture" (or Share → Capture) | text or a link → Inbox | read and write |
| **My day** | "Hey Siri, my day" | reads today's events and tasks aloud | read only is enough |

The API behind them is described in [API.md](API.md#shortcuts-api-apiv1).

## 0. Create a token

1. On anwar.os open **Settings → API tokens → Create token**.
2. Name it `iPhone Shortcuts`, choose **Read and write**, pick an expiry, tap
   **Create token**.
3. Open the **iPhone Shortcuts** tab of the dialog. Copy the **Header value**
   (`Bearer aos_…`) into Notes or a password manager for the next few minutes:
   it is shown only this once. The URLs below are on the same tab.

You can do this on the phone itself; the copy buttons work there.

Every shortcut below uses the action **Get Contents of URL** with the same
header:

- **Headers** → **Add new header** → Key `Authorization`, Value `Bearer aos_…`
  (the whole header value, with `Bearer ` in front).

If the token ever leaks, revoke it in Settings and paste a new one into the
three shortcuts.

## 1. Add expense

1. Open **Shortcuts** → **+** (new shortcut). Tap the name at the top →
   **Rename** → `Add expense`.
2. Add **Ask for Input**:
   - Input type: **Text**
   - Prompt: `How much and what? e.g. 250 coffee`
3. Add **Get Contents of URL**:
   - URL: `https://anwar-os.com/api/v1/expense`
   - Tap **▸** (Show more):
     - Method: **POST**
     - Headers: `Authorization` = `Bearer aos_…`
     - Request Body: **JSON** → **Add new field** → **Text**: key `text`,
       value: tap and pick the magic variable **Provided Input**.
4. Add **Show Notification** (or **Show Result**) and set its text to the
   **Contents of URL** variable. To have Siri say it instead, use **Speak Text**.
5. Tap **Done**.

Run it: type `250 coffee` → "Saved CZK 250 for coffee (Eating out). Spent
today: CZK 540." The line works like the Telegram expense bot: `89,90 food
lunch`, `120 transport yesterday`, `coffee 250`. When no category matches, the
expense is saved without one.

## 2. Capture

1. New shortcut, rename to `Capture`.
2. Tap **ⓘ** (Details) at the bottom → turn on **Show in Share Sheet**. At the
   top of the editor a line appears: *Receive **Any** input from **Share
   Sheet***. Tap **Any** and keep only **Text** and **URLs**. Tap **If there's
   no input: Continue** and choose **Ask For** → **Text** (prompt:
   `What do you want to save?`).
3. Add **Get Contents of URL**:
   - URL: `https://anwar-os.com/api/v1/capture`
   - Method **POST**, header `Authorization` = `Bearer aos_…`
   - Request Body: **JSON** → field **Text**: key `text`, value **Shortcut
     Input**.
4. Optional, to save somewhere else than Inbox: add a second **Text** field to
   the body with key `kind` and value `task`, `note`, `idea` or `link` (a link
   needs a web address in the text). Or put a **Choose from Menu** (Inbox, Task,
   Note, Idea) before step 3, with a **Text** action per option, and use that
   as the `kind` value.
5. Add **Show Notification** with **Contents of URL** → "Saved to Inbox."

Use it from Siri ("Capture"), the Home Screen, or **Share → Capture** in Safari,
Notes, Messages… A shared page arrives as its link.

## 3. My day

1. New shortcut, rename to `My day`.
2. Add **Get Contents of URL**:
   - URL: `https://anwar-os.com/api/v1/today`
   - Method **GET** (the default), header `Authorization` = `Bearer aos_…`
3. Add **Speak Text** with **Contents of URL** (and/or **Show Result** to read
   it on screen).

Siri then says something like: "Tuesday 24 Nov. 2 events: Standup at 10:00
to 10:15; Mum's birthday, all day. 3 tasks due: Pay rent (overdue), Call the
bank at 14:00 and Buy milk."

A read-only token is enough here; you can give this shortcut its own token
(name it `My day`, **Read only**) so it can never change anything.

## Home Screen, Siri, Action button

- **Siri:** the shortcut's name is the phrase: "Hey Siri, add expense", "Hey
  Siri, my day". Rename the shortcut to change it.
- **Home Screen:** in Shortcuts, long-press the shortcut → **Share** → **Add to
  Home Screen** (choose an icon and colour first in **ⓘ** Details if you like).
  It runs without opening the Shortcuts app.
- **Widget:** long-press the Home Screen → **Edit** → **Add Widget** →
  **Shortcuts**, and pick the three.
- **Action button** (iPhone 15 Pro and later): Settings → **Action Button** →
  **Shortcut** → *Add expense*. **Back Tap** works too: Settings →
  Accessibility → Touch → Back Tap.
- **Lock Screen:** a Shortcuts widget can run *Add expense* without unlocking
  fully (Face ID is still asked if the shortcut needs it).

## When something goes wrong

The answer is always a short sentence, shown by the notification:

| You see | Meaning |
|---|---|
| "This token is unknown, revoked or expired." | create a new token, paste its header value again (with `Bearer `) |
| "This token is read-only…" | Add expense and Capture need a **Read and write** token |
| "Send an amount, e.g. 250 coffee." | the line had no amount |
| "Too many requests…" | wait a minute |

To test from a computer: `curl -H "Authorization: Bearer aos_…" https://anwar-os.com/api/v1/today`.
