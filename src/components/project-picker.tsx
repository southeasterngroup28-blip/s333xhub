import { Chip, ChipRow } from '@/components/form';
import type { Project } from '@/lib/posts';

// Which name a post or a drop goes out under. One segmented control for
// Compose and the drop form, so MAZZE / S333XGOD reads the same in both.
const PROJECTS: Project[] = ['mazze', 's333xgod'];

type Props = {
  value: Project;
  onChange: (project: Project) => void;
  disabled?: boolean;
};

export function ProjectPicker({ value, onChange, disabled }: Props) {
  return (
    <ChipRow segmented>
      {PROJECTS.map((project) => (
        <Chip
          key={project}
          segmented
          label={project.toUpperCase()}
          on={value === project}
          disabled={disabled}
          onPress={() => onChange(project)}
        />
      ))}
    </ChipRow>
  );
}
