---
name: design-reply
description: Draft replies to people, tickets and issues about design, in the user's own voice, with an honest design assessment first. Use when the user pastes a chat message, GitHub issue, ticket comment or email that needs a reply, or when a follow-up lands on an earlier thread.
---

# Design Reply

The user pastes something that needs a reply (a chat message, a GitHub issue comment, a ticket, a developer pushing back on scope, an email from outside the team). Produce two blocks: a short honest **Assessment**, then a ready-to-paste **Draft** in their voice. Track threads so follow-ups (same or later session, same or different person) continue with full context.

Files in this skill:
- `voice.md`: the voice spec. Three registers, real anchors, a corrections log. The user fills it in once and it grows with every correction. It overrides every other voice source.
- `slop-check.md`: a pass against AI-sounding writing, tuned for short replies, with a list of voice markers it must not strip.
- `threads/`: per-thread state. Created on first use. Keep it out of version control, it holds real conversations.

Optional prefix on the input: `chat:`, `issue:` or `ext:` forces the register. Otherwise detect it.

## First run

If `voice.md` still has its `<fill in>` placeholders, ask the user for three to five messages they actually sent (chat, ticket, external) and a few words they always or never use. Fill the template from those before drafting. Until it is filled, draft in plain, short, neutral prose and say so in the Assessment.

## Step 1: Thread matching (do this FIRST, before analysing)

Thread state lives in `threads/` inside this skill folder:
- `index.md`: one line per open thread: `- [slug] people: X, Y | topic | last-updated YYYY-MM-DD`
- `<slug>.md`: one file per thread (format below)

1. Read `threads/index.md` (create the dir and file if missing).
2. Match the pasted content against open threads by: named people, topic or ticket number, quoted or referenced text from earlier messages.
3. **Match**: read that one thread file only. A new person joining the same topic is still the same thread.
4. **No match**: new thread. Slug like `alex-upload-progress`.
5. **Ambiguous**: ask the user one short question before drafting.

Never read all thread files. Index first, then exactly one file.

## Step 2: Load the voice

Read `voice.md` in full every time, including the corrections log. Pick the register (chat / ticket / external).

## Step 3: Analyse honestly (NOT a yes-man)

Before drafting, form a genuine position:

- **What's really being asked?** Surface the buried question (a developer's "would this work for you?" is often "can I ship the easy slice?").
- **Rank by user value, not build effort.** When someone proposes a descope, check whether their slice is the most valuable piece or just the easiest. Name the pieces in value order.
- **Name the actual UX pattern or tradeoff**, not abstractions. Pull product context from the project's docs or memory if there is any.
- **Concede genuinely where they're right.** Push back plainly where they're wrong.
- **Flag the deferral trap:** "future sprint whenever we have time" usually means never. Ask for the follow-up ticket to be raised and linked now.
- **Find the question that would change the answer**, if one exists.
- **Only give reasons the user can defend.** No claims about what users do without data. Use an established design principle or say what the design does.

Then decide what goes where. The draft carries the answer, at most one reason, and the one question. Everything else you worked out goes in the Assessment. This split is what keeps drafts short.

## Step 4: Draft, then slop-check

1. Write the draft from the position, in the chosen register.
2. Run `slop-check.md` against it silently. Rewrite until every check passes: wrong-reader length, sales-y self-description, staging, rhythm, words, corrections log. Respect the protected list in `voice.md`.
3. Final read: would the user type this? If any line fails, rewrite that line from the point, don't patch words.

## Step 5: Output

Two blocks, nothing else:

1. **Assessment**: 3-6 sentences. What they're really asking, where they're right, where they're wrong, what the draft argues and why, and anything you cut from the draft that the user might want to add back. If you disagree with the position the user seems inclined toward, say so here.
2. **Draft**: the reply as a quoted block, ready to paste. Sign-off rules come from the register in `voice.md`.

## Step 6: Learn from every correction

When the user rejects a draft, edits it, or says what they actually sent:

1. Work out the general rule behind it, not just the one phrase.
2. Append a BAD / GOOD line to the **Corrections log** in `voice.md` with their words and the date. If it's a new kind of failure that a check could catch, add a line to `slop-check.md` too.
3. Record the sent version in the thread file (Step 7).

Never fold a correction only into the thread file. Thread files are per person; the voice is global.

## Step 7: Persist the thread (keep it small)

Write or update `threads/<slug>.md`:

```markdown
# <topic>, <people>
channel: chat | issue | email
status: open | resolved
updated: YYYY-MM-DD

## Summary
Running 3-8 sentence summary of the whole thread: positions, decisions, open questions.
Fold older messages into this as the thread grows.

## Recent messages (last 3-4 verbatim, newest last)
**<person> (YYYY-MM-DD):** ...
**me (sent, YYYY-MM-DD):** ...
```

Rules:
- Cap the file: summary plus the last 3-4 messages. Older content folds into the summary.
- Update the `index.md` line (topic, last-updated).
- When a thread is resolved, or the user says so, set `status: resolved` and remove its line from `index.md` (keep the file).
- If `index.md` exceeds about 15 lines, mention it and offer to prune stale threads.

## Related

- General-purpose humanizer or anti-slop skills still work standalone for longer docs. Their reply-relevant rules are already merged into `slop-check.md`, so don't invoke them here.
