# 0030: An emergency is danger to people; replies follow the language a message is written in

**Status:** accepted, 2026-10-29 (ticket 63)

## Context

In the chat test a German guest wrote that water was dripping from the bathroom ceiling and the power was out. Fetivi answered in English (the language the guest chose) with "Call 112 now… leave the apartment", and said it twice, before and after the contacts card. The host's own guide said to contact the host and not use devices. The prompt treated any "danger" as an emergency and always answered in the chosen language.

## Decision

- **Two levels.** Danger to people (someone hurt or unwell, fire, smoke, sparks, a smell of gas, a person missing) is an emergency: 112 first, then `draft_host_message` with reason `emergency`, which shows 112 and the host's phone. An urgent apartment problem (a leak, a power cut, locked out, a broken lock, no water) is not: no 112, the host's own instructions if the unit record has them, plain safety steps, the host's phone, and an urgent Host message card (reason `problem`, urgency `urgent`).
- **Water near electrics** is an urgent problem: don't touch switches or sockets near the water, switch off the main fuse if safe. Only sparks, smoke, fire or an injury make it danger to people.
- **One text, then the card.** The loop ends the response after an emergency contacts card with text; a textless one gets one words-only step.
- **Reply language.** A message clearly written in another of the seven guest languages (a real sentence, not a word, greeting or place name) is answered in that language, and `suggest_replies` carries `switchLanguage`, which the guest app shows as a chip that switches the Space's language through the Settings path. Safety and emergency replies always use the language the guest wrote in.

## Rejected

- One level with softer wording: the model still reads "danger" broadly.
- Switching the language automatically: the guest chose a language, and a single message in another one is not a request to change it.

## Consequences

- The emergency list is written in three places (the prompt, the `reason` field description and the `draft_host_message` description); a change to it means editing all three.
- Emergency and urgent replies end with a card, so they carry no switch chip.
