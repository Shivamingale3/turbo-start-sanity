# NOTES

- Site: https://turbo-start-sanity-phi.vercel.app
- Studio: https://roboto-backend-shivam.sanity.studio
- Proof that everything works is in `VERIFY.md`.

I didn't track my time exactly. I did some parts in short gaps on weekdays and about 6 hours on Sunday.

I used Claude chat while working on this, mostly for writing and rewriting the documentation (this file and VERIFY.md).

For each task below I wrote what the task was, what options I had, what I did, and what I skipped.

## 1. Newsletter signup

**Task**

Make the newsletter block actually work. An email typed into the form should be saved in Sanity, and the endpoint should not be easy to abuse.

**Options**

- Post straight to Sanity from the browser, or go through our own API route.
- For abuse: a captcha, a honeypot field, a rate limit, or some mix of these.
- For the rate limit: write a small one myself, or add `@upstash/ratelimit`.
- For the rate limit algorithm: fixed window, sliding window, or leaky bucket.

**What I did**

- Added a `subscriber` document type in Studio. Email, subscribed date and source page are read only, so an editor can't change them by mistake.
- Added `POST /api/newsletter`. It checks the rate limit first, then body size, then the honeypot, then the email.
- The document ID is a hash of the email. So signing up twice doesn't create two documents, it just finds the same one.
- New and existing emails get the exact same reply. Otherwise anyone could use the form to check if an email is on the list.
- The form works without JavaScript too. A normal form post gets a 303 redirect back to the same page, and with JavaScript it shows the message inline.
- The page the signup came from is saved as the source. I only accept a path on our own site, so the redirect can't be pointed somewhere else.
- Rate limit is 5 tries per 10 minutes per IP. I wrote a sliding window limiter on Upstash Redis. If Upstash is not set or is down, it falls back to an in-memory limit instead of letting everything through.
- The IP is hashed before it goes to Redis, so raw IPs are not stored.
- 10 Playwright API tests cover this route.

**What I skipped**

- Captcha. I think the honeypot and the rate limit are enough for a newsletter form, and a captcha makes it worse for real people. If bots still got through, this is what I'd add next.
- A global cap across all IPs. Right now the limit is only per IP, so a lot of different IPs could still send many signups together.
- `@upstash/ratelimit`. I didn't want to add a new dependency, and the sliding window is only a few Redis commands.
- Leaky bucket. A sliding window was simpler to reason about for "5 tries in 10 minutes".
- A secret salt for the IP hash. Without a salt, someone with the Redis data could in theory hash IPs and match them. I think this is low risk here but a salt would be better.
- Double opt-in (a confirmation email). There's no email service in the repo.

## 2a. Sync published posts to Algolia

**Task**

When a blog post is published, edited, unpublished or deleted in Sanity, Algolia should be updated. Drafts should never get into the index.

**Options**

- Sanity webhook to our own route, or a Sanity Function.
- Send the full post in the webhook, or send only the ID and read the post again on our side.
- Process right away, or put the event in a queue and process it later.

**What I did**

- A Sanity webhook calls `/api/webhooks/algolia`. The webhook filter only fires for published blog posts.
- I check the signature myself, with an HMAC of the timestamp and the raw body, compared in constant time. If the secret is missing, every request gets 401. I didn't use `next-sanity`'s `parseBody` because its check compares with `!==`.
- The webhook only sends the ID. The route then reads the current published post from Sanity and decides from that. If it should be in search, it gets saved. If not (unpublished, deleted, Do Not Index on, hidden from lists), it gets removed. So the order of deliveries doesn't matter, the latest state always wins.
- The `objectID` is the Sanity `_id`. Sending the same delivery twice just overwrites the same record.
- The route also skips any `_id` with a dot in it (`drafts.` or `versions.`). This is a second check in case the webhook filter is changed later.
- Sometimes Sanity's read is a bit behind the publish that fired the webhook. If the post looks older than the event, it waits 1 second and reads again. If it's still behind, it returns 503 so Sanity retries.
- Any Sanity or Algolia error returns 503, so Sanity retries the delivery.
- 9 Playwright API tests cover this route.

**What I skipped**

- A timestamp age check for replays. I thought about it, but replaying an old delivery only makes the route sync the current state of that post again, which is harmless. So I left it out.
- A queue. Sanity already retries failed deliveries, and one post per event is small work, so I didn't think a queue was needed yet.
- Sanity Functions. A route was easier to test locally and with curl.

## 2b. Backfill existing posts

**Task**

Put all the posts that already exist into Algolia, since the webhook only catches changes from now on.

**Options**

- Click through the Algolia dashboard and import JSON by hand.
- A script that reads Sanity and writes to Algolia.
- How to run the script: plain `node`, `tsx`, or `sanity exec`.

**What I did**

- A script `apps/web/scripts/backfill-algolia.ts`, run from `apps/studio` with `pnpm backfill:algolia`.
- It uses the same query, the same "should this be in search" rule and the same record shape as the webhook, so both always write the same thing.
- It also removes records from the index that shouldn't be there anymore.
- The index settings (searchable fields, category filter, newest first) are set by the script, so they live in code and not only in the dashboard.
- `--dry-run` shows what it would do without writing anything.
- It's safe to run again. Same IDs, so nothing gets duplicated.

**What I skipped**

- Plain `node` and `tsx`. `node --experimental-strip-types` failed on the repo's imports without file extensions, and `tsx` would be a new dependency. `sanity exec` was already there and handles TypeScript.
- Running it on Vercel. It's a one time job, so I ran it locally against the live index.

## 2c. Search route with Algolia

**Task**

Make `/api/blog/search` use Algolia, with paging, and keep it working if Algolia is down.

**Options**

- Search from the browser with the search-only key, or keep searching on the server.
- What to do when Algolia fails: show an error, or fall back to the old Sanity search.
- How strict to be with the input.

**What I did**

- The route stays on the server and uses the search-only key. It never has a key that can write.
- The response is `{ hits, page, totalPages, total, source }`. 9 results per page, same as the blog list grid.
- Input limits: query is required and at most 100 characters, page is a whole number from 1 to 50, and category must be one of the known categories. The category goes inside an Algolia filter string, so a free text value could change the filter. Anything else gets a 400.
- Rate limit is 30 requests per minute per IP, checked before anything else. Search runs as you type, so I wanted enough room for a real person but not for a script running up the Algolia bill.
- If Algolia fails or takes longer than 2.5 seconds, it falls back to the old Sanity search (GROQ plus Fuse) with the same response shape and `"source":"fallback"`. If both fail, it returns 503.
- The fallback only reads published posts and uses the same "should this be in search" rule as the index. The old search used the page's perspective, so in local dev or a preview session it could return drafts.
- On the page, I added the category filter and paging to the search results, and kept the old results on screen while the next page loads.
- 13 Playwright API tests cover this route.

**What I skipped**

- Searching from the browser. It would be faster, but then I couldn't rate limit it or fall back if Algolia is down.
- Highlighting the matched words. The cards don't show highlights today.
- Changing the old search query. The markdown route and llms.txt also use it, so I added a new query instead of changing that one.

## 3. Studio "SEO & Index" tab

**Task**

Add a tab in Studio for blog posts that shows how the post looks in search, checks the SEO fields, and says if the post is in the Algolia index.

**Options**

- A document view tab, a field inside the form, or a separate tool.
- For the index status: call Algolia from the browser with the search-only key, or go through the web app.

**What I did**

- A second tab "SEO & Index" next to the form, only for blog posts.
- It reads the live draft, so the preview and checks update while you type, before saving.
- The preview shows the title, description and the URL breadcrumb, using the SEO fields with the normal title and description as fallback.
- Four checks, always shown with pass or fail: title length, description length, whether an image is set, and whether indexing is blocked. They show live character counts.
- Title max is 60 characters and description 140 to 160. From what I read, Google usually cuts titles at around 60 characters and descriptions at around 160, so these are common limits. They're not exact, because Google really cuts by pixel width.
- The index status looks up the post in Algolia by `objectID` with the search-only key, and compares it with the published version. Right after a publish it says "Search index is updating" and checks again after 5 seconds, because the webhook takes a moment.
- If the draft has changes that would change whether it's in search, it says so.
- The "should this be in search" rule in Studio is the same as the web app's.

**What I skipped**

- A separate Algolia key limited to only the `blog` index. The search-only key can read every index in the app. There's only one index today, but a restricted key would be safer.
- Sharing the "should this be in search" rule as one package. Right now it's written twice (Studio and web) with a comment to keep both in step.
- More SEO checks like keywords or image alt text.

## Bonus: PageSpeed

**Task**

Improve the PageSpeed score without gaming it.

**Options**

- Fix whatever the report points at: LCP, unused JavaScript, server response time.

**What I did**

- The report said the LCP element was the hero text and most of the time was "render delay". The hero animation started at `opacity: 0`, and from what I understand Chrome doesn't count invisible text as painted. I removed only the opacity from the animation. The slide and blur are still there.
- Mobile score went from 91 to 95 (middle of 3 runs each), but LCP stayed at 2.7 s. The details are in VERIFY.md.

**What I skipped**

- About 200 KiB of unused JavaScript, including zod from the env validation running in the browser. I think this is what still keeps mobile LCP at 2.7 s, but fixing it means changing how env vars reach the client, and I didn't want to risk that for a bonus task.

## Other things I noticed

- The newsletter block accepts an `action` and `onSubmit`, but the page builder never passed them, so the form didn't post anywhere. I wrapped it in a small client component that wires it to the new route.
- Vercel Analytics requests return 404 on my deployed site. I think Analytics just isn't enabled on my Vercel project.
- The first PageSpeed run had a slow server response (608 ms) and the next run was 20 ms. I think it was a cold edge cache on my deployment, not the code.