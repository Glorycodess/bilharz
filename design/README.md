# First design iteration

These seven mockups are the first iteration of the Bilharz interface, made
before the system was built. The built interface replaced them; the working
designs are on [Figma](https://www.figma.com/design/yNDxzYmsbYGOrhljmDWXmz/Bilharz),
and screenshots of the built screens are in
[`docs/evidence/features/`](../docs/evidence/features/).

| Mockup | What it became |
| --- | --- |
| [`review-queue.png`](review-queue.png) | The **Queue** page |
| [`all-samples.png`](all-samples.png) | Merged into the Queue's **All** filter, so there is one list of samples instead of two |
| [`sample-record.png`](sample-record.png) | The **Result** page for one sample |
| [`sample-review.png`](sample-review.png) | The **Review** workspace: the 12 highest-ranked tiles, the egg guide and the decision form |
| [`batch-report.png`](batch-report.png) | The **Reviews** page, with its CSV export, and the **Performance** page for the evaluation figures |
| [`decision-settings.png`](decision-settings.png) | The decision setting, compared and chosen on the Performance page ("Use this setting in the app") |
| [`sign-in.png`](sign-in.png) | Not built. Replaced by an optional review access code |

**Why there is no sign-in.** Bilharz is a research prototype. It has no user
accounts and stores no personal data: a review holds the verdict, an optional
note, an optional anonymous tester code and a timestamp. Accounts would add
personal data to protect without serving the research. Instead, the server can
require a review access code (`BILHARZ_REVIEW_CODE`) before reviews are read or
written, and an admin token (`BILHARZ_ADMIN_TOKEN`) for exporting or deleting
them. Neither is ever stored in the browser.
