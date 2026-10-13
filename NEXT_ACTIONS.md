# NEXT ACTIONS — SonicSync v10.0.2 continuation

## 1. Run the browser runtime on the actual development machine

From a fresh extraction:

```powershell
npm install
npm run validate
npm run smoke
npm start
```

For this snapshot, `npm run validate` includes both the general core suite and the dedicated phase-PLL suite.

## 2. Verify the two issues that motivated this hotfix

Use two phones plus the host:

- Start with one participant whose audio gate is still locked. The room must still permit the host to start once media is decoded and clocks are ready.
- Pause around the middle of the track, Resume, and confirm the participant continues from the paused position rather than restarting.
- During playback, induce a repeatable clock/playback skew if possible and watch `PLAYBACK ERROR` and `RATE CORRECTION`; the correction should change smoothly, not wait for a multi-second hard resync unless the error exceeds the hard threshold.

## 3. Export diagnostics after the test

Save the host JSON diagnostic export before changing the room state. It is the most useful artifact for tuning the physical/device correction loop.

## 4. Native/device gates

Android Studio + physical Android device; Xcode + iPhone; target Windows/macOS hosts; ESP-IDF + ESP32-S3 hardware.
