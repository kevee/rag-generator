---
tags: [rag-assistant]
max_turns: 60
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, AskUserQuestion]
---

I run communications for the Alder Creek Public Library and I want a chatbot for our patrons that only answers from our own pages and cites them. I have about ten pages saved from our website (hours, library cards, fines, meeting rooms, holds, the summer reading program) sitting in ~/Downloads/library-pages as .html files from Chrome. I have my own Claude API key. Walk me through getting this running on my laptop so I can show the director before we decide where to host it.
