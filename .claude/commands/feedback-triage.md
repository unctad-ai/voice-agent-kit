---
description: Triage user feedback from a voice agent deployment
argument-hint: <site> [--from DATE] [--to DATE] [--limit N] [--status STATUS]
allowed-tools: [Read, WebFetch, Bash, Grep, Glob]
---

# Feedback Triage

Triage user feedback from voice agent deployment `$ARGUMENTS`.

## Instructions

Parse arguments:
- First token is the site — either a shorthand (`kenya`, `southafrica`, `lesotho`, `bhutan`) or a full URL
- Optional flags: `--from`, `--to` (ISO dates), `--limit` (default 50), `--status` filter: `new` (default), `triaged`, `confirmed`, `dismissed`, `fixed`, or `all`

Follow the `feedback-triage` skill in this plugin (`skills/feedback-triage/SKILL.md`).

## Usage

```
/feedback-triage kenya
/feedback-triage southafrica --from 2026-03-01 --limit 10
/feedback-triage https://custom-deploy.example.com
```
