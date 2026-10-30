# What is Keystone?

Keystone is an app for reading and posting on the fediverse.

## The fediverse in one paragraph

The fediverse is a network of many small social-media servers that talk to each other. You join one server. You can still follow and reply to people on other servers. No single company owns the whole network.

## What Keystone does

Keystone lets you:

- Sign in to your server account.
- Read your home timeline and other public timelines.
- Post short messages, reply, repost, and like.
- Get notifications when people interact with you.
- Manage lists, filters, profile, and settings.

## Which servers it supports

Two server families:

- **Misskey family.** This includes Misskey itself and compatible forks. They share the same API design, so the app treats them the same.
- **Mastodon family.** This includes Mastodon itself plus Akkoma and Pleroma, which speak the same protocol.

Some features only exist on one family. The app hides or greys out buttons your server does not support, and tells you why.

## Which devices it runs on

One app, three targets:

- **iPhone and iPad** (iOS).
- **Android phones and tablets.**
- **Web browsers** on a computer.

It is built with Expo and React Native. That is just the toolkit that makes one codebase run on all three.

## Project status

Unfinished. The code repair program completed on 2026-10-25. Tests pass on computers. Checks on real phones and live servers are still pending with the owner. Expect rough edges.
