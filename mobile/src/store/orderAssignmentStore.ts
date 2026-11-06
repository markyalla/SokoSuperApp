import { create } from 'zustand';

export interface PendingAssignment {
  assignmentId?: string;
  orderId?: string;
  status?: string;
  assignedAt: string;
}

interface OrderAssignmentState {
  pendingAssignment: PendingAssignment | null;
  setAssignment: (assignment: PendingAssignment) => void;
  clear: () => void;
}

export const useOrderAssignmentStore = create<OrderAssignmentState>((set) => ({
  pendingAssignment: null,
  setAssignment: (assignment) => set({ pendingAssignment: assignment }),
  clear: () => set({ pendingAssignment: null }),
}));
