export interface SusuGroup {
  id: string;
  name: string;
  contribution_amount: number;
  cycle_period: 'weekly' | 'monthly';
  max_members: number;
  status: 'forming' | 'active' | 'completed';
  created_at: string;
  is_admin?: boolean;
  my_role?: 'admin' | 'member' | 'pending' | 'none';
}

export interface SusuMember {
  group_id: string;
  user_id: string;
  joined_at: string;
  is_admin: boolean;
  position: number;
  full_name?: string;
  phone_number?: string;
  email?: string;
}

export interface SusuContribution {
  id: string;
  group_id: string;
  user_id: string;
  amount: number;
  cycle_number: number;
  transaction_id?: string;
  created_at: string;
}

export interface SusuPayout {
  id: string;
  group_id: string;
  user_id: string;
  amount: number;
  cycle_number: number;
  transaction_id?: string;
  payout_date: string;
}

export interface CreateGroupRequest {
  name: string;
  contribution_amount: number;
  cycle_period: 'weekly' | 'monthly';
  max_members: number;
}

export interface GroupDetailResponse {
  group: SusuGroup;
  members: SusuMember[];
  member_count: number;
  my_position: number;
  is_admin: boolean;
  pending_request_count: number;
}

export interface SusuJoinRequest {
  id: string;
  group_id: string;
  user_id: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface DiscoverGroup extends SusuGroup {
  my_request_status: 'none' | 'pending' | 'approved' | 'rejected' | 'member';
}
