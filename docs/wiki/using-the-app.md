# Using the app

This describes what the app screens do, based on the code in `src/screens`. Anything not yet confirmed by tapping through the real app is marked "verify in app".

## Main tabs

The bottom bar (or sidebar on wide screens) has five tabs:

- **Home** (`/`). Your home timeline. Posts from people you follow.
- **My Network** (`/network`). Three views: social, local, and federated. Local means posts on your own server. Federated means posts your server knows about from other servers too. (Verify in app.)
- **Search** (`/explore`). Search users, tags, and posts. Also shows news discussions. (Verify in app.)
- **Notifications** (`/notifications`). Replies, mentions, follows, reposts, and likes aimed at you.
- **Profile** (`/users`). Your own profile.

## Reading posts

- Tap a post to open its thread (`/notes/:id`). You see replies around it.
- Tap a hashtag to see posts with that tag (`/tags/:tag`).
- Tap a user to see their profile (`/users/:id`), with follower and following lists.
- Pull down to refresh. Scroll to load older posts (cursor paging).
- A small badge shows whether the live stream is connected. If it is off, refresh by hand. (Verify in app.)

## Posting

- The compose button opens the post editor (`/compose`).
- You can write a new post, reply to a post, or quote a post.
- You can edit your own post where the server allows it, and redo a deleted post as a draft ("delete and redraft"). (Verify in app.)
- Drafts are saved on the device, so you can finish them later. (Verify in app.)
- If a button is missing or greyed out, your server does not support that action. The app shows the reason.

## Notifications

The notifications screen lists interactions with you. You can filter them and mark them read. Exact filter options depend on your server family. (Verify in app.)

## Lists, clips, antennas, channels

These are ways to organize posts. Availability depends on your server:

- **Lists** (`/lists`). Your custom timelines. Both families support these in some form.
- **Clips** (`/clips`). Saved collections of posts. Misskey family only. (Verify in app.)
- **Antennas** (`/antennas`). Saved searches that catch new posts automatically. Misskey family only.
- **Channels** (`/channels`). Topic rooms on Misskey family servers. (Verify in app.)

If one of these screens says "not available", your server family does not have it. That is honest, not a bug.

## Messages and chat

- **Messages** (`/conversations`). Direct messages. Mastodon family only.
- **Chat** (`/chat`). Room chat and direct messages. Misskey family only.

Both are hidden when your server does not support them. (Verify in app.)

## Drive (file storage)

The Drive screen (`/drive`) shows files you uploaded on Misskey family servers. You can upload images for posts and profile pictures from the composer and profile editor. (Verify in app.)

## Profile and settings

- **Edit profile** (`/profile/edit`). Name, bio, and similar fields. Only the fields your server allows.
- **Settings** (`/settings`). Nine sections: account, display, reactions, feeds, mutes, import, export, word filters, language.
- **Mutes and blocks** (`/settings/mutes`). People and words you hide.
- **Follow requests** (`/follow-requests`). Approve or ignore followers when your account is locked. (Verify in app.)

## Announcements and admin

- **Announcements** (`/announcements`). Notices from your server admins. Read-only.
- **Server insight** (`/admin/insight`) and **Reports** (`/admin/reports`). Admin tools. Only visible with an admin-level token. (Verify in app.)

## Switching accounts

The account menu lets you add more than one account and switch between them. Each account keeps its own data. Switching never shows the previous account's posts mixed in. Sign-out clears local data and asks the server to revoke the token.
