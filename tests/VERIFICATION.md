# Verification chain

Before a build is handed off, CI must exercise the mobile end-to-end flow:

1. Connect Live AI.
2. Natural-language show command points/highlights without pressing.
3. Pronoun follow-up presses reset and changes persistent scene/task state.
4. Next-step query uses updated state and points to the filter.
5. Filter removal animates and completes the task.
6. Fresh-state filter removal is blocked until reset.
7. Physical center/edge taps produce one response and no duplicate handlers.
8. Device shell is not recolored by generic taps.
9. One-finger touch rotate and two-finger pinch work.
10. Mocked Russian SpeechRecognition transcript enters the same AI/action path.
11. Legacy Realtime, session, health and tap-bridge runtime paths are absent.
