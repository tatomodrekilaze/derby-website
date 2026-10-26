# Maintaining Derby's search pages

The live site is GitHub Pages on `tatomodrekilaze/derby-website`, published from the root of `main`. Domain registration and DNS are separate from the website source. Do not publish changes to the retired ChatGPT Sites copy.

## Files

- `src/home.html`: the existing homepage design template.
- `src/visitor-guide.html`: practical visitor questions shared by each language.
- `js/i18n.js`: original site translations.
- `seo/content.json`: search titles, descriptions and visitor content.
- `scripts/build-seo.py`: generates `/`, `/en/`, `/ru/`, `js/seo-content.js` and `sitemap.xml`.

The generated HTML already contains complete translated text and hours. Search engines and visitors without JavaScript do not need to change a language setting. The language controls are ordinary links, and each page has its own canonical URL and reciprocal alternate-language links. Old `?lang=en` links navigate to `/en/` while retaining other query parameters and the fragment.

## Update and verify

Install authoring dependencies with `python -m pip install -r scripts/requirements.txt` if they are not present. The deployed site has no Python or new runtime dependency.

Run:

```
python scripts/build-seo.py
python scripts/check-seo.py
node --check js/main.js
node --check js/seo-content.js
node --test tests/tournament.test.cjs
```

Commit the generated pages with their source updates. The template, scripts, SEO source, tests and marketing drafts are excluded from GitHub Pages publication through `_config.yml`.

Search Console ownership uses the exact meta tag supplied by the owner's Google session. Keep it in the generated root page after verification. The sitemap is https://derbybilliards.com/sitemap.xml. The sitemap lists the three canonical language pages; it does not assert that Google has indexed them.

No ratings, reviews, central-Tbilisi location, staff languages, card acceptance or guaranteed table availability are invented. Ordinary visitor questions are presented as useful content without claiming FAQ rich-result eligibility. No advertising spend or new analytics tracker is introduced.
