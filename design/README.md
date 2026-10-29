# First design iteration

These seven mockups are the first iteration of the Bilharz interface, made
before the system was built. Each is mapped below to the built screen it led to.
The working designs are on [Figma](https://www.figma.com/design/yNDxzYmsbYGOrhljmDWXmz/Bilharz),
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
| [`sign-in.png`](sign-in.png) | Review access: reviewing is restricted by an optional review access code |

**Review access.** The server can require a review access code
(`BILHARZ_REVIEW_CODE`) before reviews are read or written, and an admin token
(`BILHARZ_ADMIN_TOKEN`) for exporting or deleting them. Neither is stored in the
browser.
