/**
 * dummyData.ts
 * ------------
 * Hardcoded content only, so the screens have something realistic to
 * display. There's no API and nothing here is persisted — this is a
 * pure UI/design pass. Wire it up to real data later.
 */
export type FileStatus = 'received' | 'commented';

export interface DesignFile {
  id: string;
  name: string;
  kind: 'pdf' | 'image';
  sentAt: string;
  status: FileStatus;
  commentCount: number;
}

export interface DesignComment {
  id: string;
  author: 'uploader' | 'viewer';
  text: string;
}

export const uploaderFiles: DesignFile[] = [
  {
    id: 'f1',
    name: 'Site-plan-v3.pdf',
    kind: 'pdf',
    sentAt: 'Sent yesterday, 4:12 pm',
    status: 'received',
    commentCount: 0,
  },
  {
    id: 'f2',
    name: 'Facade-render.png',
    kind: 'image',
    sentAt: 'Sent 3 days ago',
    status: 'commented',
    commentCount: 2,
  },
];

export const inboxFiles: DesignFile[] = [
  {
    id: 'f1',
    name: 'Site-plan-v3.pdf',
    kind: 'pdf',
    sentAt: 'From uploader, yesterday',
    status: 'received',
    commentCount: 0,
  },
  {
    id: 'f2',
    name: 'Facade-render.png',
    kind: 'image',
    sentAt: 'From uploader, 3 days ago',
    status: 'commented',
    commentCount: 2,
  },
];

export const initialComments: DesignComment[] = [
  { id: 'c1', author: 'viewer', text: 'Can we shift the entrance 2m to the left?' },
  { id: 'c2', author: 'viewer', text: 'Otherwise looks good to proceed.' },
];
