# Design QA — 轻盈计划

## Visual target and evidence

- Selected reference: `C:\Users\87271\.codex\generated_images\01a07b84-1c3b-7701-b6d3-99017a3f7b4a\exec-8b327bd7-1b25-4003-acab-a290f802af02.png`
- Final desktop implementation capture: `C:\Users\87271\Documents\ChatGPT\谭成义健身减脂计划\app\qa-implementation.png`
- Side-by-side comparison: `C:\Users\87271\Documents\ChatGPT\谭成义健身减脂计划\app\qa-comparison.png`
- Real mobile evidence: `C:\Users\87271\Documents\ChatGPT\谭成义健身减脂计划\qa-evidence-final2\01-home.png` through `05-checkin-sheet.png`
- iPhone Safari zoom report: `C:\Users\87271\AppData\Local\Temp\codex-clipboard-660f116a-65d1-4ecf-8056-eb7c6e0df567.jpg`
- iPhone duplicate-keyboard report: `C:\Users\87271\AppData\Local\Temp\codex-clipboard-76f7b040-0962-4c1a-9e15-1f7d499af0a6.jpg`

## Viewports checked

- Desktop preview: 1400 × 1200, using the protected iPhone preview runtime and a logical 393 × 852 screen.
- Phone browser: 390 × 844, using the full browser viewport with no preview bezel.

## Visual comparison

- Preserved the selected reference's bright wellness direction, warm-white canvas, green primary action, rounded white nutrition card, three macro rings, coaching strip, recent-meal card, and three-item bottom navigation.
- Kept the reference hierarchy and density while replacing decorative-only content with live plan day, stage day, review readiness, calculated targets, and genuine record counts.
- Intentional data differences reflect the implemented method: the balanced default starts at 3.0 g/kg carbohydrate, so the target is calculated from the latest body weight rather than copied from the mock.
- No cropped cards, broken radii, horizontal overflow, or unintended desktop chrome was found in the final phone viewport.
- The September 8 energy update preserves the same cards, spacing, border radii, type scale, and green selection language. The new sex symbols use a maintained icon library; inactive sex remains gray and the selected sex uses the existing green active treatment.
- The new intake/expenditure summary fits above the macro rings without obscuring the coaching strip or persistent bottom navigation at 390 × 844.

## States and interactions checked

- Today, trends, and profile navigation.
- Camera/album input entry, meal confirmation sheet, manual macro fallback, validation, and save-state lock.
- Profile editing, body-type selection, 10/15-day review selection, numeric validation, and save confirmation.
- Sex and age editing, female/male resting-energy recalculation, training intensity, strength/cardio duration, train/rest cadence selectors, and live training/rest/average estimates.
- Today training/rest override: training includes estimated exercise energy; rest sets exercise energy to zero while retaining static expenditure.
- Daily status sheet, score selection, numeric keyboard, keyboard dismissal, and saved-state return.
- Stage-scoped trends, insufficient-data and waiting states, review suggestion, and review history.
- Reload persistence through localStorage and IndexedDB photo lookup failure handling.

## Revisions completed during QA

- Made 390 × 844 use the full browser viewport while preserving the protected mobile runtime for desktop preview.
- Removed the inactive keyboard from layout and verified navigation/save returns the app scroll position to the top.
- Hid the preview-only touch cursor on real phone widths.
- Raised key touch targets to at least 44 px and raised small supporting copy to at least 11 px with stronger contrast.
- Prevented iPhone Safari focus zoom by rendering every editable input at 16 px on phone-width viewports.
- Added adaptive inputs: real phone-width browsers use only the native system keyboard, while the protected desktop device preview retains its simulated keyboard.
- Added explicit demo mode and stage IDs so first real entry clears examples atomically and same-day review records cannot leak across stages.
- Added duplicate meal-submit protection and prevented slow AI responses from overwriting manual edits.
- Replaced the old calorie target label with separate recorded intake and estimated expenditure cards.
- Added training-day, rest-day, and cycle-average expenditure while keeping the existing nutrition-coefficient workflow intact.

## Verification

- `npm run build`: passed.
- `npm run test:sites`: 4/4 passed.
- `npm run check:runtime`: passed; 28 protected runtime files unchanged.
- Logic review: no release-blocking P0 or P1 issue.
- Visual review: no unresolved P0, P1, or P2 issue.
- September 8 browser-rendered evidence: in-app browser at 390 × 844, Today and Profile states captured inline; `scrollWidth` and viewport width both measured 390 px; console warnings/errors were empty.
- Sex calculation regression: switching from male to female changed the sample rest-day estimate from 2051 to 1851 kcal and the training-day estimate from 2489 to 2290 kcal before save.
- Rest-day regression: the Today expenditure changed to 2046 kcal with `静态 2046 + 运动 0`; switching back restored the training-day estimate.
- iPhone focus regression: at 390 × 844, all seven profile inputs computed to 16 px; `visualViewport.scale` stayed at 1 before focus, while the keyboard was visible, and after dismissal; viewport width and scroll width both remained 390 px.
- Keyboard-mode regression: at 390 × 844, focus stayed on the native input while the simulated keyboard state remained false, its dock remained hidden, and no simulated “完成” control rendered. At 1200 × 900, the desktop preview still activated its simulated keyboard as intended.

Known product boundaries are intentional for this first version: without a configured server-side vision endpoint, photo entry falls back to manual macro confirmation; data remains local to the current browser; WeChat authentication and reminders require a later backend integration.

final result: passed
