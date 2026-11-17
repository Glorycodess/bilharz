import PageHeader from '../components/PageHeader.jsx'
import './Privacy.css'

const SECTIONS = [
  {
    title: 'What Bilharz receives',
    text: "One sample of 117 urine microscopy images. Before upload, the browser renames every image to upload_001.jpg through upload_117.jpg, so patient names in file names never leave the lab's computer. Bilharz never asks for patient names. If you create a reviewer account, Bilharz also receives your name, your email address and a password you choose.",
  },
  {
    title: 'How images are processed',
    text: 'Images are analysed in memory on Hugging Face servers, which are outside Rwanda, and discarded when the analysis ends. Bilharz does not save them and logs nothing about the files. The twelve highest-scoring tiles are sent back to your browser to show the result and are not stored.',
  },
  {
    title: 'What Bilharz stores',
    text: 'Review records: the sample ID, the verdict ("infected" or "healthy"), the time of each version, an optional note, and the name and account number of the reviewer who recorded it. Reviews recorded before accounts existed have no reviewer; some may have an anonymous tester code. Reviewer accounts: your name, your email address, a hash of your password (made with Argon2, from which the password cannot be read back), your role (reviewer or admin), your status (waiting for approval, approved or disabled), and when the account was created, approved, disabled or had its password changed, with which admin approved it. While a password reset link is open, a hash of it and its expiry time are stored too. Both are kept in private storage on Hugging Face, outside Rwanda. Please do not type patient names or other identifying details into notes.',
  },
  {
    title: 'Signing in and your browser',
    text: 'When you sign in, your browser receives a session cookie: a random code that cannot be read by the page itself (HttpOnly) and is sent only to Bilharz over an encrypted connection. It is the only sign-in data your browser keeps. The server keeps a hash of that code in its memory, never on disk. A session ends when you sign out, after 8 hours without use, 7 days after you signed in, when your account is disabled or its password is reset, or when the server restarts. Your browser also keeps your chosen decision setting, whether the egg guide is open, and whether you have hidden the first-time guide. It stores no passwords, review records or tokens. Bilharz sends no email: your email address is only used to sign in, and a forgotten password is reset with a one-time link that an admin gives you.',
  },
  {
    title: 'IP addresses',
    text: 'Bilharz uses IP addresses only to slow down password guessing: the server counts sign-ups, failed sign-ins and failed password resets per IP address (and failed sign-ins per email address), in memory, for 15 minutes (sign-ups for an hour). IP addresses are never written to disk or to any log, are not stored with reviews or accounts, and are forgotten when the server restarts.',
  },
  {
    title: 'Who can see the data',
    text: "Results, the queue and each review's verdict are open to everyone. Review notes and reviewers' names are shown only to signed-in reviewers whom an admin has approved. Email addresses and the list of accounts are shown only to admins. Exporting or deleting review records needs an admin, or the admin token held by the project owner.",
  },
  {
    title: 'How decisions are made',
    text: 'Bilharz counts the tiles where the detector is confident it sees an egg. Under the default Safety setting, a sample with none is cleared, a sample with more than 35 is flagged positive, and every sample in between goes to a technician. Results support screening and are not a diagnosis.',
  },
  {
    title: 'Limits of the tool',
    text: "Bilharz's egg detector was trained on one public dataset and tested on 65 patients from a second public dataset. It has not been validated with clinical users or at another site, and it is not a certified medical device.",
  },
  {
    title: 'Retention',
    text: 'Review records and accounts are kept while the research project runs; a fixed retention period has not been set yet. To have your account deleted, contact the project owner: it is disabled at once, which signs you out everywhere, and then removed from storage. Your reviews keep your name as part of the audit trail unless you also ask for them to be deleted. You can also ask for any review record to be deleted. Sessions end within 7 days, reset links after one hour, and failed-attempt counts after 15 minutes or an hour.',
  },
  {
    title: 'Third-party hosting',
    text: (
      <>
        Bilharz runs on Hugging Face, which may record technical information such as IP addresses under its own
        privacy policy (
        <a className="text-link" href="https://huggingface.co/privacy">
          https://huggingface.co/privacy
        </a>
        ). No other service receives your data: Bilharz uses no email, analytics or advertising service.
      </>
    ),
  },
  {
    title: 'Contact',
    text: (
      <>
        Questions about this policy, and requests to delete an account or review records, go to Glory Ojimaojo Paul
        at{' '}
        <a className="text-link" href="mailto:g.paul@alustudent.com">
          g.paul@alustudent.com
        </a>
        .
      </>
    ),
  },
]

export default function Privacy() {
  return (
    <div className="container page">
      <PageHeader title="Privacy policy" summary="What Bilharz receives, what it keeps, and how it decides." />

      <ol className="privacy__list">
        {SECTIONS.map(({ title, text }) => (
          <li key={title} className="privacy__item">
            <h2 className="privacy__heading">{title}</h2>
            <p className="privacy__text">{text}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}
