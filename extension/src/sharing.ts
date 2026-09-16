import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { readAccount, type Account, type Profile } from './account.js';
import { db } from './firebase.js';
import { docIdFor, mergeEditPages, mergeNotePages, type StoredEdits } from './merge.js';
import { readAllNotes, writeAllNotes, type NotePage } from './notes.js';
import { readAllEdits, writeAllEdits } from './edits.js';

export type ShareRole = 'comment' | 'edit';
export type ShareLinkAccess = 'off' | ShareRole;

export type SharedPage = {
  workspaceId: string;
  pageId: string;
  role: ShareRole;
};

export type ShareMember = {
  uid: string;
  name: string | null;
  email: string | null;
  photo: string | null;
  role: ShareRole;
  joinedAt: number;
  token?: string;
};

export type ShareInvite = {
  token: string;
  email: string;
  role: ShareRole;
  createdAt: number;
};

export type ShareState = {
  signedIn: true;
  owner: boolean;
  role: 'owner' | ShareRole;
  linkAccess: ShareLinkAccess;
  linkToken: string | null;
  members: ShareMember[];
  invites: ShareInvite[];
  profile: Profile;
  ownerProfile: Profile;
  hydrated?: { notes?: NotePage; edits?: StoredEdits };
};

type SharePageDocument = {
  pageKey: string;
  pageId: string;
  url: string;
  title: string;
  ownerId: string;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerPhoto: string | null;
  linkAccess: ShareLinkAccess;
  linkToken: string | null;
  updatedAt: number;
};

type ShareTokenDocument = {
  workspaceId: string;
  pageId: string;
  pageKey: string;
  url: string;
  title: string;
  role: ShareRole;
  allowedEmail: string | null;
  active: boolean;
  createdBy: string;
  createdAt: number;
};

const SHARED_PAGES_KEY = 'sharedPages';

const randomToken = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('');
};

async function sharedPages(): Promise<Record<string, SharedPage>> {
  const value = (await chrome.storage.local.get(SHARED_PAGES_KEY))[SHARED_PAGES_KEY];
  return value && typeof value === 'object' ? value as Record<string, SharedPage> : {};
}

async function rememberSharedPage(pageKey: string, page: SharedPage): Promise<void> {
  const pages = await sharedPages();
  pages[pageKey] = page;
  await chrome.storage.local.set({ [SHARED_PAGES_KEY]: pages });
}

export async function sharedPageFor(pageKey: string): Promise<SharedPage | null> {
  return (await sharedPages())[pageKey] ?? null;
}

/**
 * Drops a page's mapping into somebody else's workspace.
 *
 * Called when the cloud refuses a write there — the owner removed this person, or turned the link
 * off. Left in place, the mapping would send every later push to a door that stays shut, and the
 * page's notes would never reach this person's own workspace either.
 */
export async function forgetSharedPage(pageKey: string): Promise<void> {
  const pages = await sharedPages();
  if (!(pageKey in pages)) return;
  delete pages[pageKey];
  await chrome.storage.local.set({ [SHARED_PAGES_KEY]: pages });
}

export async function cloudTargetFor(pageKey: string, account: Account): Promise<SharedPage | null> {
  const shared = await sharedPageFor(pageKey);
  if (shared) return shared;
  if (!account.profile) return null;
  return { workspaceId: account.profile.uid, pageId: docIdFor(pageKey), role: 'edit' };
}

async function hydrate(pageKey: string, workspaceId: string, pageId: string): Promise<{ notes?: NotePage; edits?: StoredEdits }> {
  const [noteSnapshot, editSnapshot, localNotes, localEdits] = await Promise.all([
    getDoc(doc(db(), 'workspaces', workspaceId, 'notes', pageId)),
    getDoc(doc(db(), 'workspaces', workspaceId, 'edits', pageId)),
    readAllNotes(),
    readAllEdits(),
  ]);
  const remoteNotes = noteSnapshot.exists() ? noteSnapshot.data() as NotePage : undefined;
  const remoteEdits = editSnapshot.exists() ? editSnapshot.data() as StoredEdits : undefined;
  const notes = mergeNotePages(localNotes[pageKey], remoteNotes);
  const edits = mergeEditPages(localEdits[pageKey], remoteEdits);
  if (notes) localNotes[pageKey] = notes;
  if (edits) localEdits[pageKey] = edits;
  await Promise.all([writeAllNotes(localNotes), writeAllEdits(localEdits)]);
  return { notes, edits };
}

async function acceptToken(token: string, pageKey: string, profile: Profile): Promise<{ page: SharedPage; hydrated: { notes?: NotePage; edits?: StoredEdits } }> {
  const tokenSnapshot = await getDoc(doc(db(), 'reviewLinks', token));
  if (!tokenSnapshot.exists()) throw new Error('This invitation no longer exists.');
  const invitation = tokenSnapshot.data() as ShareTokenDocument;
  if (!invitation.active) throw new Error('This invitation has been turned off.');
  if (invitation.allowedEmail && invitation.allowedEmail !== profile.email?.trim().toLowerCase()) {
    throw new Error(`This invitation was sent to ${invitation.allowedEmail}. Sign in with that account to join.`);
  }
  const member: ShareMember & { token: string } = {
    uid: profile.uid,
    name: profile.name,
    email: profile.email,
    photo: profile.photo,
    role: invitation.role,
    joinedAt: Date.now(),
    token,
  };
  await setDoc(doc(db(), 'workspaces', invitation.workspaceId, 'pages', invitation.pageId, 'members', profile.uid), member);
  const page = { workspaceId: invitation.workspaceId, pageId: invitation.pageId, role: invitation.role } as const;
  await rememberSharedPage(pageKey, page);
  return { page, hydrated: await hydrate(pageKey, page.workspaceId, page.pageId) };
}

async function resolvePage(pageKey: string, url: string, title: string, token?: string): Promise<{ account: Account; target: SharedPage; owner: boolean; hydrated?: { notes?: NotePage; edits?: StoredEdits } }> {
  const account = await readAccount();
  if (account.mode !== 'cloud' || !account.profile) throw new Error('Sign in to share reviews with other people.');
  if (token) {
    const accepted = await acceptToken(token, pageKey, account.profile);
    return { account, target: accepted.page, owner: accepted.page.workspaceId === account.profile.uid, hydrated: accepted.hydrated };
  }
  const existing = await sharedPageFor(pageKey);
  if (existing) return { account, target: existing, owner: existing.workspaceId === account.profile.uid, hydrated: await hydrate(pageKey, existing.workspaceId, existing.pageId) };
  return { account, target: { workspaceId: account.profile.uid, pageId: docIdFor(pageKey), role: 'edit' }, owner: true };
}

export async function shareState(pageKey: string, url: string, title: string, token?: string): Promise<ShareState> {
  const resolved = await resolvePage(pageKey, url, title, token);
  const { target, account, owner } = resolved;
  const pageSnapshot = await getDoc(doc(db(), 'workspaces', target.workspaceId, 'pages', target.pageId));
  const page = pageSnapshot.exists() ? pageSnapshot.data() as SharePageDocument : null;
  const [memberSnapshots, inviteSnapshots] = page
    ? await Promise.all([
      getDocs(collection(db(), 'workspaces', target.workspaceId, 'pages', target.pageId, 'members')),
      owner ? getDocs(collection(db(), 'workspaces', target.workspaceId, 'pages', target.pageId, 'invites')) : Promise.resolve(null),
    ])
    : [null, null];
  return {
    signedIn: true,
    owner,
    role: owner ? 'owner' : target.role,
    linkAccess: page?.linkAccess ?? 'off',
    linkToken: owner ? page?.linkToken ?? null : null,
    members: memberSnapshots ? memberSnapshots.docs.map((entry) => entry.data() as ShareMember) : [],
    invites: inviteSnapshots ? inviteSnapshots.docs.map((entry: { data: () => unknown }) => entry.data() as ShareInvite).filter((invite: ShareInvite) => !memberSnapshots?.docs.some((entry) => (entry.data() as ShareMember).token === invite.token)) : [],
    profile: account.profile!,
    ownerProfile: {
      uid: page?.ownerId ?? target.workspaceId,
      name: page?.ownerName ?? null,
      email: page?.ownerEmail ?? null,
      photo: page?.ownerPhoto ?? null,
    },
    hydrated: resolved.hydrated,
  };
}

async function ownerContext(pageKey: string, url: string, title: string): Promise<{ profile: Profile; pageId: string; page: SharePageDocument | null }> {
  const account = await readAccount();
  if (account.mode !== 'cloud' || !account.profile) throw new Error('Sign in to share reviews.');
  const existing = await sharedPageFor(pageKey);
  if (existing && existing.workspaceId !== account.profile.uid) throw new Error('Only the review owner can change sharing.');
  const pageId = docIdFor(pageKey);
  const snapshot = await getDoc(doc(db(), 'workspaces', account.profile.uid, 'pages', pageId));
  return { profile: account.profile, pageId, page: snapshot.exists() ? snapshot.data() as SharePageDocument : null };
}

async function savePage(profile: Profile, pageKey: string, pageId: string, url: string, title: string, linkAccess: ShareLinkAccess, linkToken: string | null): Promise<void> {
  await setDoc(doc(db(), 'workspaces', profile.uid, 'pages', pageId), {
    pageKey, pageId, url, title, ownerId: profile.uid, ownerName: profile.name, ownerEmail: profile.email,
    ownerPhoto: profile.photo, linkAccess, linkToken, updatedAt: Date.now(),
  } satisfies SharePageDocument);
}

export async function setShareLink(pageKey: string, url: string, title: string, access: ShareLinkAccess): Promise<{ token: string | null }> {
  const context = await ownerContext(pageKey, url, title);
  const previousToken = context.page?.linkToken ?? null;
  if (access === 'off') {
    if (previousToken) await setDoc(doc(db(), 'reviewLinks', previousToken), { active: false }, { merge: true });
    await savePage(context.profile, pageKey, context.pageId, url, title, 'off', null);
    return { token: null };
  }
  const token = previousToken ?? randomToken();
  await setDoc(doc(db(), 'reviewLinks', token), {
    workspaceId: context.profile.uid,
    pageId: context.pageId,
    pageKey,
    url,
    title,
    role: access,
    allowedEmail: null,
    active: true,
    createdBy: context.profile.uid,
    createdAt: Date.now(),
  } satisfies ShareTokenDocument);
  await savePage(context.profile, pageKey, context.pageId, url, title, access, token);
  return { token };
}

export async function createInvite(pageKey: string, url: string, title: string, email: string, role: ShareRole): Promise<{ token: string }> {
  const context = await ownerContext(pageKey, url, title);
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) throw new Error('Enter a valid email address.');
  const token = randomToken();
  const createdAt = Date.now();
  await Promise.all([
    setDoc(doc(db(), 'reviewLinks', token), {
      workspaceId: context.profile.uid, pageId: context.pageId, pageKey, url, title, role,
      allowedEmail: normalizedEmail, active: true, createdBy: context.profile.uid, createdAt,
    } satisfies ShareTokenDocument),
    setDoc(doc(db(), 'workspaces', context.profile.uid, 'pages', context.pageId, 'invites', token), {
      token, email: normalizedEmail, role, createdAt,
    } satisfies ShareInvite),
    savePage(context.profile, pageKey, context.pageId, url, title, context.page?.linkAccess ?? 'off', context.page?.linkToken ?? null),
  ]);
  return { token };
}

export async function removeShareMember(pageKey: string, url: string, title: string, uid: string): Promise<void> {
  const context = await ownerContext(pageKey, url, title);
  const memberReference = doc(db(), 'workspaces', context.profile.uid, 'pages', context.pageId, 'members', uid);
  const memberSnapshot = await getDoc(memberReference);
  const token = memberSnapshot.exists() ? (memberSnapshot.data() as ShareMember).token : undefined;
  const invitation = token ? await getDoc(doc(db(), 'reviewLinks', token)) : null;
  const emailInvite = invitation?.exists() && Boolean((invitation.data() as ShareTokenDocument).allowedEmail);
  await Promise.all([
    deleteDoc(memberReference),
    ...(token && emailInvite ? [
      setDoc(doc(db(), 'reviewLinks', token), { active: false }, { merge: true }),
      deleteDoc(doc(db(), 'workspaces', context.profile.uid, 'pages', context.pageId, 'invites', token)),
    ] : []),
  ]);
}
