export interface FreelancerUser {
  [key: string]: unknown;
  id: number;
  username: string;
  display_name: string;
  avatar: string;
  role: string;
  reputation?: {
    entire_history?: {
      overall?: number;
      reviews?: number;
    };
  };
  location?: {
    country?: { name?: string };
    city?: string;
  };
  registration_date?: number;
  jobs?: Array<{ name: string }>;
  hourly_rate?: number;
  earnings?: { earnings?: number };
  tagline?: string;
}

export interface FreelancerProject {
  [key: string]: unknown;
  id: number;
  title: string;
  description?: string;
  status: string;
  type: string;
  budget?: { minimum?: number; maximum?: number; currency_code?: string };
  bid_stats?: { bid_count?: number; bid_avg?: number };
  time_submitted?: number;
  time_updated?: number;
  jobs?: Array<{ name: string }>;
  owner_id?: number;
  hired_freelancers?: number[];
}

export interface FreelancerBid {
  [key: string]: unknown;
  id: number;
  project_id: number;
  bidder_id: number;
  amount: number;
  period: number;
  description: string;
  status: string;
  time_submitted?: number;
  reputation?: { overall?: number };
  bidder?: FreelancerUser;
}

export interface FreelancerMilestone {
  [key: string]: unknown;
  id: number;
  project_id: number;
  amount: number;
  description: string;
  status: string;
  time_created?: number;
  time_updated?: number;
  currency?: { code?: string };
}

export interface FreelancerMessage {
  [key: string]: unknown;
  id: number;
  thread_id: number;
  from_user: number;
  message: string;
  time_created?: number;
  attachments?: Array<{ filename: string; url: string }>;
}

// The threads endpoint returns each item with the thread details nested
// under `thread`, and per-folder metadata (message_count, time_updated) at
// the top level.
export interface FreelancerThread {
  [key: string]: unknown;
  id: number;
  thread?: {
    id: number;
    thread_type?: string;
    members?: number[];
    owner?: number;
    context?: { type?: string; id?: number };
    time_created?: number;
  };
  message_count?: number;
  time_updated?: number;
}

export interface ApiResponse<T> {
  status: string;
  result: T;
  request_id?: string;
  error_code?: string;
  message?: string;
}
