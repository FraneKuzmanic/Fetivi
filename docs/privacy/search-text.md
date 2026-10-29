# How Fetivi searches for places

> Draft for the guest Privacy page. Translations come with that page.

When you ask Fetivi for places, events or transport, the assistant turns your request into a short search phrase, like "fresh fish for dinner", and sometimes a phrase for what you want to avoid, like "seafood". To find the places that match by meaning, and not only by the exact words, Fetivi sends those phrases to Voyage AI, an embedding service in the United States.

- Voyage receives only these short phrases (up to 200 characters each), not your whole conversation.
- Fetivi does not send Voyage your name, Stay or contact details. The phrases are written from what you asked for, so they can carry a wish you also gave in About me, such as "vegetarian" or "with kids".
- Fetivi keeps the search phrases only as part of your conversation.

Fetivi also sends Voyage the public descriptions of the places it knows and the notes hosts publish about their own places, so it can compare them with your search.

If Voyage cannot answer, Fetivi still searches: it then matches your words directly.

---

Internal, not for the guest page: before production, opt out of model training in the Voyage dashboard and check Voyage's retention terms.
