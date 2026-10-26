Twitter/X renders a quote retweet as your own post containing an embedded card for the original post. It is not a screenshot of the original, nor a second full timeline post.

## What it looks like

Your Name @you · 2h

Here's my take on this.

Original Author @author · 5h

This is the original post's text, rendered inside the embedded card.

Original post media, if present

Illustrative layout, not a pixel-exact screenshot. Based on X's quote-post behavior and observed card layout.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://help.x.com\&sz=32)

X Help Center

+1



## How the rendering works

1\. The outer post is a normal timeline post.

It uses your avatar, name, handle, timestamp and commentary. Its content determines the post's overall height.

2\. The original is a nested card.

The card sits beneath your commentary, inside the outer post's content area. It has a thin border, rounded corners and internal padding, visually distinguishing it from your own text.

3\. The original has its own compact header and content.

Inside the card, render the original author's identity, timestamp, text and media. Images and videos belong to this inner card rather than appearing as independent timeline attachments.

4\. The card adapts to the available width.

It fills the available content column rather than using a fixed size. Text wraps within that width, and media must scale or crop according to the normal media-rendering rules. On mobile, the card becomes narrower along with the timeline.

5\. The original is interactive.

The embedded card links to the original post. Its own full conversation and details are accessed by opening that post; you do not need to duplicate its entire interface inside the quote card.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://twitterapi.io\&sz=32)

TwitterAPI.io



6\. Nested quotes do not need unlimited visual nesting.

If the original post is itself a quote post, the outer card represents that immediate original. The earlier post can be reached by opening it, avoiding an endlessly nested stack of cards.

## How I would implement it

Treat the quote as a composition of two existing components:

```
TimelinePost
├── PostHeader
├── PostBody                 ← your commentary
├── PostMedia                ← your attachments, if any
├── QuotedPostCard           ← original post
│   ├── PostHeader
│   ├── PostBody
│   └── PostMedia
└── PostActions              ← actions for your post
```

The key is to reuse the regular post-rendering logic inside `QuotedPostCard`, with a compact presentation mode. The card has its own layout and interaction boundary, but it should not render another complete timeline row with its own action toolbar.

Also handle an unavailable original: preserve the outer post and its commentary, replacing the inner card's content with an unavailable-post message.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://twitterapi.io\&sz=32)

TwitterAPI.io
