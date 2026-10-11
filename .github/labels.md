# Issue labels

xcwds/xcwds and xcwds/xcwds.github.io use the same labels, so one routine can rank work across both.
Keep this file identical in both repos. Agents can't define labels, but adding a label that a repo
doesn't have creates it with a grey color and no description; the owner then sets the color and
description from the tables below. Never invent labels outside this file.

Every open issue gets one type label, and one priority label unless it is `tracking`. Add `needs
decision` when it applies. Renovate's "Dependency Dashboard" issue gets no labels.

## Type

| Label           | Use for                                                            |
| --------------- | ------------------------------------------------------------------ |
| `bug`           | Something that exists and behaves wrongly                          |
| `enhancement`   | A new feature, tool, recipe or improvement                         |
| `documentation` | Docs, READMEs, comments and contributor notes only                 |
| `security`      | Data exposure, privacy leaks (anything that could phone home), CSP |
| `accessibility` | A barrier for people using assistive tech, keyboards or large text |
| `tooling`       | CI, build, release workflows, dependencies and test infrastructure |

An issue can carry more than one type (`bug` + `security`) when both are true.

## Priority

| Label                | Meaning                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `priority: critical` | Data loss, a security or privacy hole, or the app or a release broken for all |
| `priority: high`     | Broken behavior people hit, or it blocks other planned work                   |
| `priority: medium`   | Correctness edge cases and meaningful improvements                            |
| `priority: low`      | Nits, docs, polish and nice-to-haves                                          |

The "Issue to PR" routine works the highest priority first and breaks ties toward the smaller,
older issue.

## Status

| Label            | Meaning                                                                             |
| ---------------- | ----------------------------------------------------------------------------------- |
| `needs decision` | The owner must choose something first (open questions, proposals, RFC choices)      |
| `tracking`       | An epic, plan or umbrella issue; the work happens in its sub-issues, so no priority |

Automated issue work skips `needs decision` and `tracking` issues. Remove `needs decision` once the
issue records the owner's answer.

## Set by people

`human requested`, `refinement requested`, `branding`, `good first issue`, `help wanted`, `question`,
`duplicate`, `invalid` and `wontfix` are applied by people. Agents never add or remove them, and
read `human requested` as a sign the owner cares about the issue.
