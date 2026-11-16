import PageHeader from '../components/PageHeader.jsx'
import './Privacy.css'

const SECTIONS = [
  {
    title: 'What Bilharz receives',
    text: "One sample of 117 urine microscopy images. Before upload, the browser renames every image to upload_001.jpg through upload_117.jpg, so patient names in file names never leave the lab's computer. Bilharz has no user accounts and collects no names or email addresses.",
  },
  {
    title: 'How images are processed',
    text: 'Images are analysed in memory on Hugging Face servers, which are outside Rwanda, and discarded when the analysis ends. Bilharz does not save them and logs nothing about the files. The twelve highest-scoring image regions are sent back to your browser to show the result and are not stored.',
  },
  {
    title: 'What Bilharz stores',
    text: 'Only review records: the sample ID, the verdict ("infected" or "healthy"), the time of each version, and an optional note and tester code if the reviewer adds them. Records are kept in private storage on Hugging Face, outside Rwanda. Bilharz never asks for patient names, so please do not type patient names or other identifying details into notes. Your browser keeps only your chosen decision setting and whether the egg guide is open; it stores no review records, codes or tokens.',
  },
  {
    title: 'Who can see the data',
    text: 'Reading and recording reviews can be limited to people with an access code; without one, anyone with access to Bilharz can read the review records, including notes. Exporting or deleting review records requires an admin token held by the project owner.',
  },
  {
    title: 'How decisions are made',
    text: 'Bilharz counts the image regions where the detector is confident it sees an egg. Under the default Safety setting, a sample with none is cleared, a sample with more than 35 is flagged positive, and every sample in between goes to a technician. Results support screening and are not a diagnosis.',
  },
  {
    title: 'Limits of the tool',
    text: "Bilharz's egg detector was trained on one public dataset and tested on 65 patients from a second public dataset. It has not been validated with clinical users or at another site, and it is not a certified medical device.",
  },
  {
    title: 'Retention',
    text: 'Review records are kept while the research project runs. A fixed retention period has not been set yet. You can ask for review records to be deleted by contacting the project owner.',
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
        ).
      </>
    ),
  },
  {
    title: 'Contact',
    text: (
      <>
        Questions about this policy go to Glory Ojimaojo Paul at{' '}
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
