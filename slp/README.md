# slp

`slp` is the repository copy of the `slp` Bash function: a small countdown
wrapper around `sleep` that accepts seconds, `MM:SS`, or `HH:MM:SS`.

```bash
./slp/slp 90
./slp/slp 01:30
./slp/slp 00:01:30
```

The countdown stays on one terminal line and exits after printing `Done!`.
