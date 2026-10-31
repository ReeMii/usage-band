# usage-band

A band above the prompt, on the desktop surface, showing the week's usage against the week's seven
days. Each of the bar's seven sections is a day of the window and a seventh of the limit, named
above its end by the day most of it falls on. Today's name is bright. The percent and the time the
week ends sit to the right.

The fill is green while it has not reached today's section, blue inside it, orange once it is 80%
of the way through, and red past today's divider; on the last day it goes straight to red at that
80%. Unused days carry over, because the
colour compares everything used so far with today's divider. A day turns at the reset's time of
day, not at midnight.

The figures come with a model response, so a new session shows the last reading any session kept,
dimmed, until its first reply. Usage in other sessions shows up here with this session's next reply.

Only one band draws above the prompt, so this one stacks whatever is beneath it, and
`implement-scope-band` does the same.

## Installing it

At the prompt of a terminal session:

```
/plugin install usage-band --marketplace ReeMii/usage-band
```

From a shell:

```
claude plugin install usage-band --marketplace ReeMii/usage-band
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add
marketplace with `ReeMii/usage-band`, then Add plugin.
