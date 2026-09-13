/**
 * The shape of a kept handoff, declared here rather than imported from the inspector.
 *
 * The component exports the same type, but importing it into the service worker would drag React and
 * the whole panel into a bundle whose job is to write a document to Firestore. It is structural and it
 * is small; a copy with a comment saying so is cheaper than that.
 */
export type HandoffDocument = {
  url: string;
  title: string;
  author: string;
  markdown: string;
  css: string;
  changeCount: number;
  noteCount: number;
  issueCount: number;
  /** A PNG data URL, when one was captured. Uploaded to Cloud Storage, never into the document. */
  screenshot: string | null;
};
