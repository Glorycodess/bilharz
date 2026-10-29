import { EXPECTED_IMAGES } from '../../api.js'

// Every file from a drop, including the contents of dropped folders.
export async function filesFromDrop(dataTransfer) {
  // Entries must be read synchronously, before the first await.
  const entries = [...dataTransfer.items].map((item) => item.webkitGetAsEntry?.()).filter(Boolean)
  if (entries.length === 0) return [...dataTransfer.files]
  const files = []
  async function walk(entry) {
    if (entry.isFile) {
      files.push(await new Promise((resolve, reject) => entry.file(resolve, reject)))
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      for (;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject))
        if (batch.length === 0) break
        for (const child of batch) await walk(child)
      }
    }
  }
  for (const entry of entries) await walk(entry)
  return files
}

// Exactly the sample's JPEGs, in name order; system files like .DS_Store are skipped.
export function checkFiles(all) {
  const files = all
    .filter((f) => !f.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const notJpeg = files.filter((f) => !/\.jpe?g$/i.test(f.name))
  if (files.length === 0) return { files: [], error: 'No images found. Choose the folder with the sample’s images.' }
  if (notJpeg.length > 0) {
    const what = notJpeg.length === 1 ? '1 file is' : `${notJpeg.length} files are`
    return {
      files: [],
      error: `${what} not a JPEG (for example ${notJpeg[0].name}). A sample is ${EXPECTED_IMAGES} .jpg images.`,
    }
  }
  if (files.length !== EXPECTED_IMAGES) {
    return {
      files: [],
      error: `${files.length} ${files.length === 1 ? 'image' : 'images'} found. A sample needs exactly ${EXPECTED_IMAGES}.`,
    }
  }
  return { files, error: null }
}
