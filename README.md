# Substack → Framer sync

A small automation that keeps the **Journal** page of my portfolio ([arianaparrilha.com/journal](https://arianaparrilha.com/journal)) in sync with my weekly learning journal on [Substack](https://arianaparrilha.substack.com).

Every Tuesday morning, a GitHub Action reads my Substack RSS feed, adds any new posts to a Framer CMS collection (title, cover, excerpt, date and link) and publishes the site. No copy-pasting, no forgetting to update the portfolio.

## Why

I write one journal entry a week about my path as a product designer: the job search, courses and personal projects. I wanted my portfolio to show that writing without having to maintain the same content in two places. Substack stays the place to read; the portfolio becomes the index.

## How it works

1. **Read the feed:** the script fetches the Substack RSS feed and extracts each post’s title, subtitle, cover image, date and URL.
2. **Compare:** it checks which posts already exist in the Framer CMS, matching them by slug.
3. **Add what’s new:** new posts are added through the [Framer Server API](https://www.framer.com/developers/server-api-quick-start), with the cover image uploaded to Framer.
4. **Sort and publish:** the collection is sorted newest first and the site is published. If nothing changed, nothing is published.

## Stack

- [Framer Server API](https://www.framer.com/developers/server-api-quick-start) (`framer-api`)
- GitHub Actions (scheduled weekly, plus manual runs)
- Node.js, with no other dependencies

## Use it for your own site

1. Create a CMS collection in Framer with these fields: `Title` (text), `Cover` (image), `Excerpt` (text), `Date` (date) and `Substack link` (link). If you use a different collection name, change `COLLECTION_NAME` in `sync-substack.mjs`.
2. Generate an API key in your Framer site settings.
3. Fork this repo and add two repository secrets:
   - `FRAMER_API_KEY`: your Framer API key
   - `FRAMER_PROJECT_URL`: your project URL (`https://framer.com/projects/...`)
4. Set the `SUBSTACK_FEED_URL` environment variable in the workflow, or edit the default in the script.
5. Optional: add a repository variable `AUTO_DEPLOY=false` if you’d rather review a preview and publish manually.
6. Run it from **Actions → Sync Substack → Framer → Run workflow**.

## Notes

- The Framer Server API is in open beta, so details may change.
- Only new posts are added. Edits to older Substack posts aren’t synced back.
- Publishing publishes the whole Framer project, including any unpublished canvas changes.
