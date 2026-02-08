# Bushido Browser — Claude Instructions

## Changelog Rules

When committing a version bump, tagged release, or when asked to update the changelog:

1. Read the existing `CHANGELOG.md` first for style reference
2. Read the git log since the last version to understand what changed
3. Write the entry in the Bushido voice:
   - Short sentences, lowercase energy
   - Explain **why** a feature matters, not just what it is
   - No "we're excited to announce", no corporate fluff, no emoji
   - No "phase" references, no mentioning other browsers by name
   - Bold feature names, backtick keyboard shortcuts
   - If something is a big deal, say so plainly — don't hype it
4. Format: `## vX.Y.Z` header, `**YYYY-MM-DD**` date line, `### Category` sections (Added, Changed, Fixed, Theme, Removed)
5. Never co-author commits

## Code Rules

- Follow Optimization.txt guidelines (transform/opacity only for animations, useMemo/useCallback for stable refs, virtualize lists >50 items)
- Server = ES modules (.js), Client = TypeScript
- No unnecessary abstractions. Three similar lines > premature helper function
- Tauri v2 patterns: `app.get_window("main")` for add_child, `emit_to` for targeted events, `initialization_script()` for page-load injection
