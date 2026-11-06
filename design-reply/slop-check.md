# Slop check (run on every draft before showing it)

A merge of the no-ai-slop and humanizer (blader/humanizer) skills, cut down to what goes wrong in short replies, ordered by how often it goes wrong. Section numbers like §26 point at humanizer for the long version with examples.

Run it silently. Rewrite the draft until every check passes, then output. Never show the checklist. If a fix would change a fact or a position, stop and say so in the Assessment instead.

## 1. Wrong reader (the most frequent failure)

The other person already has the context. Rebuilding it buries the point. (humanizer §26)

- Does the first sentence answer what they asked? If the answer is in the last line, move it up.
- Cut any restatement of their problem, their message, or background they wrote or agreed to.
- Keep only reasoning that would change whether they agree: usually one fact they lack.
- Count it. Chat: 2-3 short lines unless it's a real debate. External: 2-3 short paragraphs. Over that? Move the extra into the Assessment.
- No numbers, metrics or proof they didn't ask for.

## 2. Sales-y self-description

A model describes a person's work as a method.

- Any "I + present-tense verb + philosophy" line ("I lead with", "I decide X before Y", "I believe in")? Rewrite as a plain fact about what you did or do: "most of my work now is...", "I started out in brand".
- Any claim that the fit is great, the role is exciting, the work is impactful? One plain line at most.
- Would the reader take it for a social media post? Rewrite.

## 3. Staging instead of stating (act on one sighting)

- Not X but Y, in every form: "it's not X, it's Y", "not just X", "X rather than Y", the split two-sentence version, the clipped tail ("..., no guessing"). State Y. (§1)
- One-line closers and fragment rows: "that's the real win", "that distinction matters", "No X. No Y." Delete. End on the last concrete point or the real question. (§2)
- Sayings that sound deep: "the real question is", "at its core", "the heart of it", "X is the Y of Z". (§3)
- Staged run-ups: "Here's the thing", "Honestly?" as a standalone opener, "Let me be clear", "quick note", "heads up", "worth flagging". Cut, say the thing. (§4)
- Arguing with no one: "to be clear", "I'm not saying", "don't get me wrong", rejecting an option nobody raised. (§5)
- Colon reveals: "The fix: we drop the button." Rewrite as a sentence.
- Faux insight: "what most people miss", "this is the classic X problem".

## 4. Rhythm and decoration

- Dashes: zero. Includes " -- " and spaced hyphens used as dashes. (§8)
- Forced triads: three items where the meaning has two, or three parallel examples. Keep real threes. (§6)
- Three sentences in a row starting the same way. (§7)
- Bold, headers, bullet lists in a chat reply. Tickets may use a numbered list for real separate decisions. (§19-20)
- Curly quotes in a chat or GitHub draft: straighten them. (§21)

## 5. Words

- Chatbot residue: "I hope this helps", "Great question", "let me know", "Would you like", "happy to help". (§22)
- Banned: delve, leverage, utilize, facilitate, empower, streamline, robust (figurative), seamless, crucial, pivotal, key (adjective), enhance, showcase, highlight (verb), underscore, align with, landscape, ecosystem (figurative), journey, holistic, synergy, table stakes, north star, the play here, game changer, testament, foster, harness, elevate, meticulous, intricate, valuable.
- Shallow -ing riders: "..., ensuring X", "..., highlighting Y". Cut or say the real consequence. (§15)
- Fake-strong verbs: "serves as", "acts as", "boasts", "features". Use is / has. (§18)
- Portability test: could this sentence go unchanged into a different company's thread? Cut it or make it about this feature, this ticket, this person.

## 6. Protected (do NOT strip these, whatever the generic skills say)

Generic anti-slop rules treat words like "honestly / just / actually" as empty and flag casual candor. If they are in the **Protected voice markers** list in `voice.md`, they are voice, not slop. Leave them in when they sit inside a sentence. Only flag one when it's a standalone staged opener ("Honestly? ...") or when it appears twice.

Also leave alone whatever the register in `voice.md` says is normal for the user: lowercase starts, dropped apostrophes, exclamation marks, fragments, hedges, greetings and sign-offs.

## 7. Final read

- Read it as the user typing on their phone. Anything they'd never type? Rewrite that line, don't patch a word.
- Did the rewrite add or drop a fact, name, number, ticket or position? Either is an error.
- Check every BAD in the voice.md corrections log. None may appear.

## 8. Profile and bio copy

- No mission-statement opener ("I build X for Y", "I help teams Z"). Start from a plain fact: what you are, how long, where you work.
- No mirrored clauses ("I build X, and I design the Y that ship from X").
- Plain past-tense facts with concrete nouns, no "specialism" labels, no colon lists of nouns with a fragment closer.

## 9. Claims

- Any line asserting what users do ("most people never...", "nobody reads...") without data? Replace with an established design principle or say what the design does. The user has to be able to defend every reason in the thread.

## 10. Follow-ups

- Cut any line that asks them to look, thanks them in advance ("I'd really appreciate"), or re-pitches what they can already read. A follow-up states the new fact in one line and stops, warmly.
