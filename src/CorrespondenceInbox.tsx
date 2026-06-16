import React from 'react';
import { User } from 'firebase/auth';
import { AppUser } from './types';
import { AppView } from './App';
import CorrespondingsDashboard from './CorrespondingsDashboard';

interface Props {
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  onNavigate: (v: AppView) => void;
  initialStatusFilter?: string;
  /** Legacy deep-link target. The former "Inbox" tab is now the review queue,
   *  so landing there pre-filters the unified list to items needing review. */
  initialTab?: 'correspondences' | 'inbox';
}

/**
 * The former "Correspondences" and "Inbox" tabs are now a single unified list:
 * logging, reviewing, and assigning all happen in one place
 * (`CorrespondingsDashboard`), with a team-workload panel shown to managers.
 * This thin wrapper just maps legacy deep-links onto the right initial filter.
 */
export default function CorrespondenceInbox({ initialTab, initialStatusFilter, ...rest }: Props) {
  const statusFilter = initialStatusFilter ?? (initialTab === 'inbox' ? 'NeedsReview' : undefined);
  return <CorrespondingsDashboard {...rest} initialStatusFilter={statusFilter} />;
}
