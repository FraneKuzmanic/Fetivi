# How Fetivi searches for places

> Draft for the guest Privacy page. Translations come with that page.

When you ask Fetivi for places, events or transport, the assistant turns your request into a few search words, like "fresh fish for dinner". To find the places that match by meaning, and not only by the exact words, Fetivi sends those search words to Voyage AI, an embedding service in the United States.

- Voyage receives only the search words the assistant chose, not your whole conversation.
- Voyage receives no name, Stay, contact details or anything from About me.
- Fetivi keeps the search words only as part of your conversation.

Fetivi also sends Voyage the public descriptions of the places it knows and the notes hosts publish about their own places, so it can compare them with your search.

If Voyage cannot answer, Fetivi still searches: it then matches your words directly.

---

Internal, not for the guest page: before production, opt out of model training in the Voyage dashboard and check Voyage's retention terms.
