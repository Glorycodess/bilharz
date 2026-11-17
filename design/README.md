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
| [`sign-in.png`](sign-in.png) | **Sign in** and **Create an account** for reviewers, and the **Admin** page that approves them |

**Review access.** The sign-in mockup (email, password, "Remember this device",
"Forgot password?", "All review actions are logged") first became an optional
review access code. After the final report, following facilitator feedback, it
became reviewer accounts, close to the mockup with three differences: a
reviewer also signs up (name, email, password) and an admin approves the account
before it can record or read reviews; a session always lasts at most 7 days,
so there is no "Remember this device"; and a forgotten password is reset with a
one-time link from an admin, since Bilharz sends no email. As the mockup
promised, every review action is logged, under the reviewer's name. Results and
the queue stay open without signing in. Inside the huggingface.co page, where
browsers do not keep the sign-in, the sign-in screens offer Bilharz in a new tab
instead of a form. The admin token (`BILHARZ_ADMIN_TOKEN`) makes the first admin
and remains the fallback for exporting or deleting reviews; it is never stored
in the browser. The built screens:
[sign in](../docs/evidence/features/sign-in.jpg),
[create an account](../docs/evidence/features/sign-up.jpg),
[the review page before signing in](../docs/evidence/features/review-sign-in-prompt.jpg)
and [admin](../docs/evidence/features/admin.jpg).
