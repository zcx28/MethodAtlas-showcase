# AesthePDF layout guidance

Source: https://github.com/Techd81/AesthePDF (MIT).
Pinned revision: `3d22176f24e22265f93920b62051d16b2ed1daa6`.

`layout-guidance.md` retains the upstream decision workflow with unrelated agent
installation examples removed. `composition.original.md` and `LICENSE` retain
upstream text and attribution.

`backend/paper_layout.py` loads this guidance with MethodAtlas adaptation rules
and requests a validated JSON layout plan. Existing manuscript blocks supply the
content; Typst handles rendering. The model cannot rewrite manuscript text,
execute commands or choose arbitrary files. AesthePDF's renderer is not used.
