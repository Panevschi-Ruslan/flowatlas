import { useEffect } from 'react';

export interface WorkspaceEvent {
  type: string;
  parcelId: string;
  courierId?: string;
}

/**
 * The hook every screen opens the workspace's stream through. The address is
 * read here; the function the frames go to is the one each caller hands in.
 */
export function useWorkspaceEvents(workspaceId: string, onEvent: (event: WorkspaceEvent) => void): void {
  useEffect(() => {
    const source = new EventSource(`${import.meta.env.VITE_SHIPPING_URL}/workspaces/${workspaceId}/events`);
    source.onmessage = (frame) => onEvent(JSON.parse(frame.data) as WorkspaceEvent);
    return () => source.close();
  }, [workspaceId]);
}
