# Footer logo reference images

Drop the two approved Growth99 footer logos here (exact filenames):

- `growth99-white.png` — white mark + white "Growth99" text (for dark backgrounds)
- `growth99-color.png` — sage/green mark + black "Growth99" text (for light backgrounds)

Both are tagline-free. Transparent background preferred.

Used by `apps/worker/src/lib/footerLogoVision.ts` to match the footer logo via
vision. If the files are absent the check still runs from a text description.
Override the directory with env `FOOTER_LOGO_REF_DIR`.
