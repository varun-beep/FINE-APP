# SpendCoach — iPhone Mobile Safari Manual Testing Guide

This checklist is tailored specifically for testing SpendCoach as an installed PWA or directly in Mobile Safari on iOS (tested on iPhone 12 Mini / SE / 15 / 16 Pro).

---

## 1. Add to Home Screen (PWA Standalone Mode)
- [ ] Open Mobile Safari and navigate to your deployed SpendCoach URL (or `https://<tunnel-or-domain>`).
- [ ] Tap the iOS Safari **Share button** (square with up arrow).
- [ ] Scroll down and tap **"Add to Home Screen"**.
- [ ] Confirm the app icon appears with the 180x180 px SpendCoach branding icon and title "SpendCoach".
- [ ] Tap the newly created Home Screen icon to launch the app:
  - [ ] Launches without browser chrome (URL bar, navigation bar hidden).
  - [ ] Status bar style matches theme (`black-translucent` with dark background).
  - [ ] Splash transition is seamless.

---

## 2. Passcode Authentication & Security
- [ ] If logged out, the `/login` screen displays:
  - [ ] Passcode input autofocuses immediately.
  - [ ] iOS triggers the clean numeric keypad (`inputMode="numeric"`, `pattern="[0-9]*"`).
- [ ] Enter an invalid passcode (e.g. `9999`):
  - [ ] Input displays error vibration/shake animation.
  - [ ] "Invalid passcode. Please try again." appears with remaining retry attempts.
- [ ] Enter the configured valid passcode:
  - [ ] Logs in immediately without page reload.
  - [ ] 30-day session cookie is stored.

---

## 3. Daily Gold & Good-Habit Toggle
- [ ] On the Home dashboard, locate the **Daily Gold** investment card.
- [ ] Tap / toggle today's gold investment:
  - [ ] Streak counter increments immediately.
  - [ ] Investment expense row is recorded with category `Investment` and kind `investment`.
  - [ ] Today's Safe-to-Spend daily allowance decreases by today's investment amount, protecting your savings target.
  - [ ] Cumulative gold holdings update live.

---

## 4. Rapid Expense Logging & Input Shorthands
- [ ] Tap the **"+ Log Expense"** quick-action button:
  - [ ] Sheet slides up with numeric keyboard focused.
- [ ] Test amount shorthands in the amount field:
  - [ ] Type `250` -> parses as ₹250.00.
  - [ ] Type `1.5k` -> parses as ₹1,500.00.
  - [ ] Type `25k` -> parses as ₹25,000.00.
  - [ ] Type `1.2L` -> parses as ₹1,20,000.00.
  - [ ] Type `₹ 4,850.50` -> parses as ₹4,850.50.
- [ ] Test category auto-selection from merchant:
  - [ ] Type `Swiggy` in merchant -> category automatically highlights **Food**.
  - [ ] Type `Uber` in merchant -> category automatically highlights **Transport**.
- [ ] Category chips ordering:
  - [ ] Observe that your most frequently used categories appear first at the top of the chip list.
- [ ] Quick-repeat combos:
  - [ ] Tapping a quick-repeat pill (e.g. "Swiggy • ₹450") logs the transaction in 1 tap.

---

## 5. Day Closure & Fast-Path Backfill
- [ ] **State A: Spent today**:
  - [ ] With expenses logged today, tap **"Close Day as Spent"** (or auto-logged).
  - [ ] Day closure status updates to `logged`.
- [ ] **State B: No-spend today**:
  - [ ] On a day with zero discretionary expenses, tap **"Mark as No-Spend Day"**.
  - [ ] Day closure status records `no_spend`.
  - [ ] Streak counter increments.
- [ ] **Fast-Path Backfill (Settings)**:
  - [ ] Navigate to **Settings** (`/settings`).
  - [ ] Tap **"Treat Past Days With Entries as Closed"**.
  - [ ] Instant backfill records closures for all historical dates with spend rows.
  - [ ] Unlocks the Learning Gate immediately after seeding or data import.

---

## 6. Daily Review & Coach Insights
- [ ] Navigate to **Review** (`/review`):
  - [ ] Coach Review renders within seconds.
  - [ ] **Tone**: Supportive, objective, calm. Zero moralising, shame, or guilt-tripping language.
  - [ ] **Numbers**: Every number matches engine evidence (allowance, spent so far, lever savings). No invented rates or figures.
  - [ ] **Tomorrow's Action**: One clear, concrete action referencing a specific lever or tomorrow's allowance.
  - [ ] **Win**: Highlights positive behavior (under allowance, savings on track, or drift reversing) or states null if none true.
  - [ ] If remaining discretionary budget is used up: states `"This month's discretionary budget is used up; you are ₹X over"`, never `"₹0.00 (over)"`.

---

## 7. iOS Safe-Area & Layout Polish
- [ ] Inspect bottom navigation bar and action buttons on iPhone with Home Indicator (iPhone X through 16):
  - [ ] Bottom action buttons (`env(safe-area-inset-bottom)`) do not collide with the iOS home indicator bar.
  - [ ] Top header respects the Dynamic Island / Notch (`env(safe-area-inset-top)`).
  - [ ] Sheet overlays do not bounce or lock scrolling when rubber-banding.

---

## 8. Offline Mode & PWA Resilience
- [ ] Turn on **Airplane Mode** on your iPhone.
- [ ] Reload or navigate SpendCoach:
  - [ ] Cached app shell and recent spending state load offline.
  - [ ] Offline banner indicates offline state.
- [ ] Turn off **Airplane Mode**:
  - [ ] Reconnects seamlessly and synchronizes state.
