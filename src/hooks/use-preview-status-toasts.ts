import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { PreviewStatus, Project } from '@/lib/types';

export function usePreviewStatusToasts(projects: Project[]) {
  const prevPreviewStatuses = useRef<Map<string, PreviewStatus>>(new Map());

  useEffect(() => {
    const prev = prevPreviewStatuses.current;
    const next = new Map<string, PreviewStatus>();

    for (const project of projects) {
      for (const save of project.saves) {
        next.set(save.id, save.previewStatus);
        const was = prev.get(save.id);
        if (was === 'pending' && save.previewStatus === 'ready') {
          toast.success(`Preview attached to "${save.label}"`);
        }
      }
    }

    prevPreviewStatuses.current = next;
  }, [projects]);
}
