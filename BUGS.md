# Bug List

## Bug 1 — Source links don't open
Clicking a sources link in the chat response doesn't open anything.
- **Location:** `widget/embed.html` (iframe context)
- **Likely cause:** Links inside iframe have no `target="_blank"` or are blocked by sandbox/iframe restrictions.
